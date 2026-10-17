import { resolveModelPolicy } from '../model-policy.mjs';
import { taskIntent } from '../task-intent.mjs';

export const MAX_TASK = 120000;
const continuation = /^(?:那|please\s+)?(?:繼續|继续|開始做|开始做|接著|接着|照做|做吧|修好它|再試|再试|continue\b|go ahead\b|proceed\b|do it\b|try again\b|resume\b)/i;
const newTask = /^(?:(?:please|can you|help me)\s+|請|请|幫我|帮我)?(?:inspect\b|review\b|assess\b|find\b|read\b|explain\b|locate\b|fix\b|implement\b|build\b|write\b|create\b|compare\b|check\b|add\b|update\b|delete\b|new task\b|查看|檢查|检查|檢視|尋找|查找|讀取|阅读|說明|说明|評估|评估|定位|修正|實作|实现|建立|比較|比较|新增|更新|刪除|删除|新任務|新任务|換個話題|换个话题)/i;
const contextualAction = /^(?:(?:please|can you|help me)\s+)?(?:fix|review|check|implement|build|write|update|add|delete)\s+(?:it|that|this|the above|option)\b/i;
const prefixedContextualMutation = /^(?:(?:can you|could you|please)\s+)?(?:also|then|next)\s+(?:add|update|delete|fix|implement|write|create|modify|change)\b|^(?:那|然後|然后|接著|接着)(?:再)?(?:新增|更新|刪除|删除|修正|修改|實作|实现)/i;
const mechanical = /typo|spelling|錯字|拼字|機械/i;
/** Classifies the current message without copying prior prompt text into the result. */
export function classifyTurn({ text, newImages = false, state = {} }) {
  const normalized = String(text ?? '').trim();
  if (!newImages && taskIntent(normalized).operational) return 'operational';
  if (!normalized || continuation.test(normalized) || contextualAction.test(normalized)
      || prefixedContextualMutation.test(normalized)) return 'continuation';
  if (newImages || newTask.test(normalized) || (!state.query && state.resumed !== true)) return 'development';
  return 'ambiguous';
}

/** Only held in memory. Never add thread text to catalog/status/log payloads. */
export function routingStateFromThread(thread) {
  const state = { query: null, hasImages: false, contextTokens: 0 };
  for (const turn of thread?.turns ?? []) {
    for (const item of turn.items ?? []) {
      if (item.type !== 'userMessage') continue;
      const text = (item.content ?? []).filter(input => input.type === 'text')
        .map(input => input.text ?? '').join('\n').split('\n\nBounded context evidence:\n')[0];
      if (text) state.query = prepareTurnRouting({ text, state }).nextQuery;
      state.hasImages ||= (item.content ?? []).some(input => /^(image|localImage)$/.test(input.type));
    }
  }
  state.contextTokens = Math.ceil(JSON.stringify(thread?.turns ?? []).length / 4);
  return state;
}

export function prepareTurnRouting({ text, newImages = false, state = {} }) {
  text = text.trim();
  if (text.length > MAX_TASK) throw new Error('Task must be at most 120000 characters');
  const classification = classifyTurn({ text, newImages, state });
  const followup = classification === 'continuation';
  const query = followup && state.query ? `${state.query}\n${text}` : text || 'Inspect attached image';
  if (query.length > MAX_TASK) throw new Error('Routing task context exceeded limit; restate the bounded task');
  return { query, followup, classification, unknownContinuation: followup && !state.query,
    hasImages: state.hasImages === true || newImages,
    contextTokens: (state.contextTokens ?? 0) + Math.ceil(text.length / 4),
    nextQuery: followup && !state.query ? null : query };
}

/** Native CLI and managed surfaces use exactly the same risk/effort/capability decision. */
export function selectTurnPolicy({ routing, plan, models, usage, model = null, effort = null, extraContextTokens = 0 }) {
  const preference = routing.unknownContinuation ? 'strong-reasoning-preferred'
    : taskIntent(routing.query).readOnly || mechanical.test(routing.query) ? 'lightweight-preferred' : 'balanced-preferred';
  const effectivePlan = routing.unknownContinuation ? { ...plan,
    contextHints: { ...plan.contextHints, modelPreference: 'strong-reasoning-preferred' } } : plan;
  return resolveModelPolicy({ plan: effectivePlan, models, usage, advisoryPreference: preference,
    requestedModel: model, requestedEffort: effort ?? (effectivePlan.contextHints?.modelPreference === 'strong-reasoning-preferred' ? 'high' : 'medium'),
    hasImages: routing.hasImages, contextTokens: routing.contextTokens + extraContextTokens });
}
