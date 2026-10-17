import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexRunner, threadStartParams, turnStartParams } from '../src/codex-runner.mjs';
import { CodexRunner as SharedRunner, shouldInheritActiveTask, workspacePlan } from '../../../intelligence/agent-runtime/runtime.mjs';
import { normalizeAppServerEvent } from '../../../intelligence/agent-runtime/activity-adapter.mjs';
import { buildDeveloperInstructions } from '../../../intelligence/agent-runtime/runtime-policy.mjs';
import { constrainedWriteRoots, executionWorkspace } from '../../../intelligence/agent-runtime/orchestration-context.mjs';
import { acquireRuntimeWriteLease as acquireLease } from '../../../intelligence/agent-runtime/write-leases.mjs';
import { createTurnTelemetry, normalizeTokenUsage } from '../../../intelligence/agent-runtime/telemetry.mjs';

const acquireRuntimeWriteLease = (roots, options = {}) => acquireLease(roots, { lockDirectory: leaseDirectory, ...options });
const leaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "totem-runtime-test-locks-"));
after(() => fs.rmSync(leaseDirectory, { recursive: true, force: true }));

test('Discord is a facade for the shared runtime and authoritative developer policy', () => {
  assert.equal(CodexRunner, SharedRunner);
  const plan = { affectedModules: ['totem-core'], execution: { maxConcurrentWrites: 1 }, independentReviewRequired: true };
  const params = threadStartParams({ workspace: '/srv/workspace', orchestrationPlan: plan });
  assert.equal(params.developerInstructions, buildDeveloperInstructions({ plan }));
  assert.match(params.developerInstructions, /minimum total model-token consumption/);
  assert.doesNotMatch(params.developerInstructions, /must.*spawn|Worker =|Reviewer =/);
});

test('shared runtime supports read-only inspection and explicit constrained module write roots', () => {
  const common = { workspace: '/srv/workspace', threadId: 'thread', prompt: 'Inspect', writableRoots: ['/srv/workspace/TotemCore'] };
  assert.deepEqual(turnStartParams(common).sandboxPolicy.writableRoots, common.writableRoots);
  assert.equal(threadStartParams({ ...common, readOnly: true }).sandbox, 'read-only');
  assert.deepEqual(turnStartParams({ ...common, readOnly: true }).sandboxPolicy, { type: 'readOnly' });
});

test('planned constraints never generate agent lifecycle or fictional token/model telemetry', () => {
  assert.deepEqual(normalizeAppServerEvent({ method: 'bridge/modelPolicy', params: { routing: [{ modelHint: 'lightweight-preferred' }] } }), []);
  const event = normalizeAppServerEvent({ method: 'item/completed', params: { item: {
    id: 'real', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child'], model: 'catalog-lightweight'
  } } })[0];
  assert.equal(event.item.type, 'collab_tool_call');
  assert.equal(event.item.model, 'catalog-lightweight');
  assert.deepEqual(event.item.receiver_thread_ids, ['child']);
  const missing = normalizeAppServerEvent({ method: 'item/started', params: { item: { id: 'missing', type: 'collabAgentToolCall' } } })[0];
  assert.equal(missing.item.model, undefined);
  assert.equal(normalizeAppServerEvent({ method: 'item/completed', params: { item: {
    type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'inProgress', receiverThreadIds: ['unconfirmed']
  } } }).some(entry => entry.type === 'agent.spawned'), false);
  const actual = normalizeAppServerEvent({ method: 'item/completed', params: { item: {
    type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child']
  } } }).find(entry => entry.type === 'agent.spawned');
  assert.equal(actual.agentId, 'child');
  assert.equal(actual.model, undefined);
  const usage = { total: { inputTokens: 40, outputTokens: 10, totalTokens: 50 } };
  assert.deepEqual(normalizeAppServerEvent({ method: 'thread/tokenUsage/updated', params: { threadId: 'actual', tokenUsage: usage } }),
    [{ type: 'usage.updated', thread_id: 'actual', turn_id: undefined, usage: usage.total, token_usage: usage }]);
  assert.deepEqual(normalizeAppServerEvent({ method: 'thread/compacted', params: {
    threadId: 'actual', turnId: 'turn', reason: 'private prompt'
  } }), [{ type: 'context.compacted', thread_id: 'actual', turn_id: 'turn' }]);
});

test('turn telemetry preserves unknown counters and never retains content', () => {
  assert.deepEqual(normalizeTokenUsage({ inputTokens: 12, cachedInputTokens: 4 }), {
    inputTokens: 12, cachedInputTokens: 4, cacheWriteInputTokens: null,
    outputTokens: null, reasoningOutputTokens: null, totalTokens: null
  });
  const telemetry = createTurnTelemetry({ tokenUsage: { inputTokens: 12, outputTokens: 3 },
    boundedContext: '私密 prompt', compactionCount: 1 });
  assert.equal(telemetry.boundedContext.bytes, Buffer.byteLength('私密 prompt'));
  assert.equal(telemetry.boundedContext.tokenCountKind, 'estimated-from-utf8-bytes');
  assert.deepEqual(telemetry.compaction, { status: 'observed', observedCount: 1, evidence: 'runtime-event' });
  assert.ok(!JSON.stringify(telemetry).includes('私密 prompt'));
  assert.deepEqual(createTurnTelemetry().compaction, { status: 'unknown', observedCount: null, evidence: null });
  assert.deepEqual(normalizeTokenUsage({ inputTokens: null, outputTokens: '' }), {
    inputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null,
    outputTokens: null, reasoningOutputTokens: null, totalTokens: null
  });
});

test('module roots come only from authoritative graph ownership with no broad fallback', () => {
  const knowledge = { root: '/srv/TotemWorkspace', modules: [{ id: 'totem-core', repoName: 'TotemCore' }] };
  assert.deepEqual(constrainedWriteRoots({ writeScope: [{ moduleId: 'totem-workspace', paths: ['TotemWorkspace/**'] }] }, knowledge), ['/srv/TotemWorkspace']);
  assert.deepEqual(constrainedWriteRoots({ writeScope: [] }, knowledge), []);
  assert.throws(() => constrainedWriteRoots({ writeScope: [{ moduleId: 'unknown', paths: ['/'] }] }, knowledge), /Unknown write-scope module/);
  assert.throws(() => constrainedWriteRoots({}, knowledge), /authoritative write scope/);
});

test('writable execution cwd cannot implicitly broaden a module sandbox to its parent workspace', () => {
  assert.equal(executionWorkspace('/srv/workspace', ['/srv/workspace/TotemCore']), '/srv/workspace/TotemCore');
  assert.equal(executionWorkspace('/srv/workspace', [], true), '/srv/workspace');
  assert.throws(() => executionWorkspace('/srv/workspace', []), /authorized root/);
});

test('operational turns use workspace-owned read-only plans without changing the session cwd', () => {
  const workspace = '/srv/workspace/TotemLumen';
  const plan = workspacePlan({ prompt: 'Show current token usage', workspace,
    routing: { classification: 'operational' } });
  assert.deepEqual(plan.affectedModules, ['totem-workspace']);
  assert.deepEqual(plan.writeScope, []);
  assert.ok(plan.waves.every(wave => !wave.writeAllowed));
  assert.equal(executionWorkspace(workspace, [], true), workspace);
  assert.ok(!JSON.stringify(plan).includes('totem-lumen'));
  assert.equal(shouldInheritActiveTask({ classification: 'operational' }), false);
  assert.equal(shouldInheritActiveTask({ classification: 'development' }), false);
  assert.equal(shouldInheritActiveTask({ classification: 'ambiguous' }), true);
  assert.equal(shouldInheritActiveTask({ classification: 'continuation' }), true);
});

test('process-wide write ownership permits disjoint roots and rejects nested or overlapping tasks', () => {
  const releaseCore = acquireRuntimeWriteLease(['/tmp/totem-runtime-lease-test/TotemCore']);
  const releaseOther = acquireRuntimeWriteLease(['/tmp/totem-runtime-lease-test/TotemNexus']);
  try {
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/totem-runtime-lease-test/TotemCore']), error => error.code === 'RUNTIME_WRITE_CONFLICT');
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/totem-runtime-lease-test']), /overlapping writable root/);
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/totem-runtime-lease-test/TotemCore/src']), /overlapping writable root/);
  } finally { releaseCore(); releaseOther(); }
  const releaseAfter = acquireRuntimeWriteLease(['/tmp/totem-runtime-lease-test']);
  releaseAfter();
});

test('runtime releases write ownership after model preflight failure', async () => {
  const runner = new CodexRunner({ leaseDirectory, planImpl: () => ({ writeScope: [] }), probeRuntime: async () => { throw new Error('preflight failed'); } });
  const workspace = '/tmp/totem-runtime-release-test';
  const task = { key: 'failed-preflight', workspace, writableRoots: [workspace], prompt: 'Fix', orchestrationPlan: { writeScope: [] } };
  await assert.rejects(runner.execute(task), /preflight failed/);
  const release = acquireRuntimeWriteLease([workspace]);
  release();
  assert.equal(runner.isRunning(task.key), false);
});
