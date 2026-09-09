#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentAdapter } from '../intelligence/agent-adapter.mjs';
import { loadKnowledge } from '../intelligence/workspace-knowledge.mjs';
import { buildOrchestrationPlan } from '../intelligence/orchestration-plan.mjs';
import { CORE_DEVELOPER_INSTRUCTIONS } from '../intelligence/agent-runtime/runtime-policy.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-agent-adapter-'));
const workspaceRoot = path.join(root, 'TotemWorkspace');
fs.mkdirSync(workspaceRoot);
const knowledge = loadKnowledge();
const calls = [];
const events = [];
const settled = [];
let complete;
const runtimeImpl = {
  execute(options) { calls.push(options); return new Promise(resolve => { complete = resolve; }); },
  approve(...args) { calls.push({ approval: args }); },
  cancel(key) { calls.push({ cancel: key }); },
  steer(key, text) { calls.push({ steer: { key, text } }); return true; }
};
const probe = async () => ({ models: [{ model: 'test-spark', inputModalities: ['text'], supportedReasoningEfforts: ['medium'] },
  { model: 'test-astra', inputModalities: ['text', 'image'], supportedReasoningEfforts: ['medium'] }],
  usage: null, capabilities: { appServerAvailable: true, modelCatalogAvailable: true, lightweightAvailable: true, intelligenceAvailable: true } });
const settings = { workspaceRoot, reposRoot: root, knowledge, runtimeImpl, probeRuntime: probe,
  spawnSyncImpl: () => ({ status: 0, stdout: 'codex-cli 1.0.0' }),
  env: { TOTEM_AGENT_ADAPTER: 'codex' }, onActivity: event => events.push(event),
  onTaskSettled: task => settled.push(task) };
const tick = () => new Promise(resolve => setImmediate(resolve));
try {
  const off = createAgentAdapter({ ...settings, env: {} });
  assert.equal(off.status().available, false);
  await assert.rejects(off.dispatch({ prompt: 'x' }), { code: 'ADAPTER_UNAVAILABLE' });
  assert.equal(createAgentAdapter({ ...settings, env: { TOTEM_AGENT_ADAPTER: 'codex', TOTEM_CODEX_CWD: '/elsewhere' } }).status().available, false);
  assert.equal(createAgentAdapter({ ...settings, env: { TOTEM_AGENT_ADAPTER: 'codex', TOTEM_CODEX_SANDBOX: 'danger-full-access' } }).status().available, false);
  const adapter = createAgentAdapter(settings);
  assert.equal(adapter.status().ready, false, 'Version alone is not runtime readiness');
  const prompt = 'Refactor TotemWorkspace orchestration runtime';
  const plan = buildOrchestrationPlan({ query: prompt });
  const task = await adapter.dispatch({ prompt, orchestrationPlan: plan });
  assert.equal(task.state, 'running');
  assert.equal(adapter.status().ready, true);
  assert.equal(calls[0].orchestrationPlan, plan);
  assert.ok(calls[0].boundedContext);
  assert.equal(calls[0].autoApproveGradle, false);
  assert.ok(!('assignments' in calls[0].modelPolicy));
  assert.equal(events.filter(event => event.type === 'agent_spawned').length, 0);
  await assert.rejects(adapter.dispatch({ prompt }), { code: 'AGENT_BUSY' });
  const run = calls[0];
  run.onProgress({ method: 'error', params: { error: { message: 'temporary disconnect' }, willRetry: true } });
  assert.equal(adapter.status().busy, true, 'Retryable notifications cannot release task ownership');
  run.onSessionId('thread-1');
  run.onProgress({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  run.onProgress({ method: 'item/completed', params: { item: { type: 'fileChange', changes: [{ path: path.join(workspaceRoot, 'intelligence/example.mjs'), kind: 'update', diff: '+ bounded' }] } } });
  run.onProgress({ method: 'item/started', params: { item: { type: 'mcpToolCall', server: 'totemWorkspace', tool: 'impact', arguments: {} } } });
  run.onProgress({ method: 'item/completed', params: { item: { type: 'mcpToolCall', server: 'totemWorkspace', tool: 'impact', result: { ok: true } } } });
  run.onProgress({ method: 'item/started', params: { item: { type: 'commandExecution', command: 'node scripts/validate-workspace.mjs' } } });
  run.onProgress({ method: 'item/completed', params: { item: { type: 'commandExecution', command: 'node scripts/validate-workspace.mjs', exitCode: 0, aggregatedOutput: 'passed' } } });
  run.onProgress({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 30, outputTokens: 20 }, total: { inputTokens: 100, outputTokens: 20 } } } });
  run.onProgress({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'Implemented and validated.' } } });
  run.onProgress({ method: 'item/completed', params: { item: { type: 'reasoning', text: 'private reasoning' } } });
  run.onProgress({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } });
  run.onApproval({ requestId: 7 });
  assert.deepEqual(calls.at(-1).approval, [task.id, 7, 'decline']);
  complete({ exitCode: 0, message: 'Implemented and validated.', model: 'test-astra', usage: { last: { inputTokens: 100, outputTokens: 20 } } });
  await tick();
  assert.equal(adapter.status().lastTask.state, 'completed');
  assert.equal(adapter.status().lastTask.threadId, 'thread-1');
  assert.equal(adapter.status().lastTask.usage.totalTokens, 120);
  assert.equal(adapter.status().lastTask.chosenModel, 'test-astra');
  assert.equal(settled.length, 1);
  for (const type of ['file_edit', 'thread_started', 'turn_started', 'tool_started', 'tool_completed', 'command_started', 'command_completed', 'agent_message', 'usage_updated', 'task_completed']) {
    assert.ok(events.some(event => event.type === type), type);
  }
  assert.ok(!JSON.stringify(events).includes('private reasoning'));
  assert.equal(events.filter(event => event.type === 'task_completed').length, 1);
  const next = await adapter.dispatch({ prompt, orchestrationPlan: plan, threadId: 'thread-1' });
  assert.equal(calls.findLast(call => call.prompt)?.resumeSessionId, 'thread-1');
  assert.equal(adapter.steer('Use a narrower scope'), true);
  adapter.close('cancelled');
  assert.equal(adapter.status().lastTask.state, 'failed');
  assert.ok(calls.some(call => call.cancel === next.id));
  complete({ exitCode: 0 });
  await tick();
  assert.equal(adapter.status().lastTask.state, 'failed', 'Cancellation cannot become success');
  const unavailable = createAgentAdapter({ ...settings, probeRuntime: async () => ({ models: [], capabilities: { appServerAvailable: false } }) });
  await assert.rejects(unavailable.dispatch({ prompt, orchestrationPlan: plan }), { code: 'MODEL_POLICY_BLOCKED' });
  assert.equal(unavailable.status().lastTask.state, 'failed');
  const failing = createAgentAdapter({ ...settings, runtimeImpl: { ...runtimeImpl, execute: async () => { throw new Error('runtime stopped'); } } });
  await failing.dispatch({ prompt, orchestrationPlan: plan });
  await tick();
  assert.equal(failing.status().lastTask.state, 'failed');
  const cancelled = createAgentAdapter({ ...settings, probeRuntime: () => new Promise(resolve => { complete = resolve; }) });
  const pending = cancelled.dispatch({ prompt, orchestrationPlan: plan });
  cancelled.close();
  complete(await probe());
  await assert.rejects(pending, /cancelled/);
  assert.match(CORE_DEVELOPER_INSTRUCTIONS, /does not prescribe your internal agent topology/);
  assert.match(CORE_DEVELOPER_INSTRUCTIONS, /minimum total model-token/);
  const adapterSource = fs.readFileSync(new URL('../intelligence/agent-adapter.mjs', import.meta.url), 'utf8');
  assert.ok(!adapterSource.includes('["exec", "--json"'));
  assert.match(adapterSource, /CodexRunner/);
  console.log('Agent adapter validation passed: shared App Server, constraints, bounded context, capabilities, usage, telemetry, safe approvals, resume, cancellation and failures.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
