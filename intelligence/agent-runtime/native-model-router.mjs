import path from 'node:path';
import { buildOrchestrationPlan } from '../orchestration-plan.mjs';
import { MAX_TASK, prepareTurnRouting, routingStateFromThread, selectTurnPolicy } from './turn-routing.mjs';

/** In-memory routing only. No prompt, transcript or credential is written to disk. */
export class NativeModelRouter {
  constructor({ knowledge, cwd, catalog, model = null, effort = null, onDecision = () => {} }) {
    Object.assign(this, { knowledge, cwd, catalog, model, effort, onDecision });
    this.threads = new Map();
    this.candidates = new WeakMap();
  }

  observe(message, request = null) {
    const thread = message.result?.thread;
    if (thread?.id && /^thread\/(start|resume|fork)$/.test(request?.method ?? '')) {
      if (this.threads.size >= 64 && !this.threads.has(thread.id)) throw new Error('Router thread limit reached');
      const state = { ...routingStateFromThread(thread), resumed: request.method === 'thread/resume',
        cwd: message.result.cwd ?? thread.cwd ?? request.params?.cwd ?? this.cwd };
      this.threads.set(thread.id, state);
    }
    if (message.method === 'thread/tokenUsage/updated') {
      const state = this.threads.get(message.params?.threadId);
      const usage = message.params?.tokenUsage?.last;
      if (state && usage && Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens)) {
        state.contextTokens = usage.inputTokens + usage.outputTokens;
      }
    }
    if (request?.method === 'turn/start' && message.result) {
      const state = this.threads.get(request.params?.threadId);
      const candidate = this.candidates.get(request);
      if (state && candidate) Object.assign(state, candidate);
    }
  }

  async route(message) {
    if (message.method !== 'turn/start') return message;
    const params = message.params;
    if (!params || !Array.isArray(params.input)) throw new Error('Invalid turn input');
    // Server/tool continuations do not constitute a new task and keep their configured model.
    const text = params.input.filter(input => input.type === 'text').map(input => input.text ?? '').join('\n').trim();
    const newImages = params.input.some(input => /^(image|localImage)$/.test(input.type));
    if (!text && !newImages) return message;
    if (text.length > MAX_TASK) throw new Error('Task must be at most 120000 characters');
    const state = this.threads.get(params.threadId);
    if (!state) throw new Error('Start or resume the thread through this router before sending a turn');
    const routing = prepareTurnRouting({ text, newImages, state });
    const cwd = path.resolve(params.cwd ?? state.cwd);
    const moduleId = cwd === path.resolve(this.knowledge.root) ? 'totem-workspace'
      : this.knowledge.modules.find(module => module.repoName === path.basename(cwd))?.id ?? null;
    const plan = buildOrchestrationPlan({ query: routing.query, moduleId, knowledge: this.knowledge });
    const { models, usage } = await this.catalog();
    const decision = selectTurnPolicy({ routing, plan, models, usage, model: this.model, effort: this.effort });
    if (decision.mode === 'blocked' || !decision.coordinator.model) throw new Error('No available model satisfies this task; turn was not started');
    const routed = { ...params, model: decision.coordinator.model, effort: decision.coordinator.effort };
    // Collaboration mode takes precedence over top-level model/effort in the native protocol.
    if (params.collaborationMode) {
      routed.collaborationMode = { ...params.collaborationMode, settings: { ...params.collaborationMode.settings,
        model: routed.model, reasoning_effort: routed.effort } };
    }
    this.onDecision({ threadId: params.threadId, model: routed.model, effort: routed.effort,
      reasons: decision.reasonCodes, evidence: 'selected-for-next-turn' });
    const result = { ...message, params: routed };
    this.candidates.set(result, { query: routing.nextQuery, hasImages: routing.hasImages, cwd });
    return result;
  }
}
