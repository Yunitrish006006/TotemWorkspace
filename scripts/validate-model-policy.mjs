import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolveModelPolicy, isLightweightModel, QUOTA_MAX_AGE_MS } from '../intelligence/model-policy.mjs';
import { probeCodexRuntime as probeRuntime } from '../intelligence/codex-runtime-probe.mjs';
const probeCodexRuntime = options => probeRuntime({ ...options,
  spawnSyncImpl: () => ({ status: 0, stdout: 'codex-cli 1.2.3' }) });
// Fixture identifiers are intentionally not the production identifiers.
const SPARK_MODEL = 'future-codex-spark';
const DEFAULT_STRONG_MODEL = 'future-astra';
const now = 1800000000000;
const models = [DEFAULT_STRONG_MODEL, SPARK_MODEL].map(model => ({ model,
  supportedReasoningEfforts: ['medium', 'high'], inputModalities: model === DEFAULT_STRONG_MODEL ? ['text', 'image'] : ['text'] }));
const plan = { waves: [{ id: 'discovery', modelHint: 'lightweight-preferred' }, { id: 'contract', modelHint: 'strong-reasoning-preferred' }], execution: { maxConcurrentWrites: 1 } };
const unchanged = JSON.stringify(plan);
const usage = (general, spark, checkedAt = now) => ({ checkedAt, rateLimitsByLimitId: {
  codex: { primary: { usedPercent: general, resetsAt: now / 1000 + 500 } },
  codex_bengalfox: { primary: { usedPercent: spark, resetsAt: now / 1000 + 500 } }
} });
const policy = values => resolveModelPolicy({ plan, models, usage: usage(10, 10), now, ...values });
assert.equal(policy().coordinator.model, SPARK_MODEL);
assert.equal(policy().mode, 'lightweight-preferred');
assert.equal(policy().routing[1].model, DEFAULT_STRONG_MODEL);
assert.equal(policy({ usage: usage(100, 1) }).mode, 'spark-only');
assert.equal(policy({ usage: usage(100, 100) }).mode, 'blocked');
assert.equal(policy({ usage: usage(100, NaN) }).mode, 'blocked');
assert.equal(policy({ usage: usage(100, 1), models: [] }).mode, 'blocked', 'Never invent model availability');
assert.equal(policy({ hasImages: true }).coordinator.model, DEFAULT_STRONG_MODEL);
assert.equal(policy({ usage: undefined }).coordinator.model, SPARK_MODEL);
assert.equal(policy({ requestedModel: 'removed-model' }).coordinator.model, SPARK_MODEL);
assert.equal(policy({ models: [models[0]] }).coordinator.model, DEFAULT_STRONG_MODEL);
assert.equal(policy({ plan: { execution: { sharedContractStabilizationRequired: true } } }).coordinator.model, DEFAULT_STRONG_MODEL);
assert.equal(policy({ escalation: 'non-local-failure' }).coordinator.model, DEFAULT_STRONG_MODEL);
assert.equal(policy({ escalation: 'non-local-failure', usage: usage(100, 1) }).mode, 'blocked');
assert.equal(policy({ usage: usage(100, 1, now + 1) }).quotaEvidence.general.status, 'unknown');
assert.equal(policy({ usage: usage(100, 1, now - QUOTA_MAX_AGE_MS - 1) }).quotaEvidence.general.status, 'unknown');
assert.equal(policy({ requestedEffort: 'high' }).coordinator.effort, 'high');
assert.equal(policy({ requestedEffort: 'ultra' }).coordinator.effort, 'medium');
assert.ok(isLightweightModel({ id: 'bounded-coder', capabilities: { lightweight: true } }));
assert.equal(policy({ contextTokens: 5000, models: [{ ...models[1], contextWindow: 4000 }, models[0]] }).coordinator.model, DEFAULT_STRONG_MODEL);
assert.equal(JSON.stringify(plan), unchanged);
assert.ok(!('assignments' in policy()));
assert.equal(policy().optimization.secondaryGoal, 'minimize-total-model-tokens');

function fakeRuntime({ timeout = false, rpcError = false, malformed = false } = {}) {
  const messages = [];
  const kills = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  child.kill = signal => { kills.push(signal); child.emit('close', 0); };
  child.stdin.write = line => {
    const message = JSON.parse(line); messages.push(message);
    if (message.method === 'initialized' || timeout) return;
    queueMicrotask(() => {
      if (malformed) { child.stdout.emit('data', 'not json secret-token\n'); return; }
      let result = {};
      if (message.method === 'model/list') result = message.params.cursor
        ? { data: [{ model: SPARK_MODEL, description: 'secret-token', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }], nextCursor: null }
        : { data: [{ model: DEFAULT_STRONG_MODEL }], nextCursor: 'page2' };
      if (message.method === 'account/rateLimits/read') result = { ...usage(4, 5), privateToken: 'secret-token' };
      child.stdout.emit('data', JSON.stringify(rpcError ? { id: message.id, error: { message: 'secret-token' } } : { id: message.id, result }) + '\n');
    });
  };
  return { messages, kills, spawnImpl: (_bin, args, options) => {
    assert.deepEqual(args, ['app-server']); assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']); return child;
  } };
}
const fake = fakeRuntime();
const result = await probeCodexRuntime({ spawnImpl: fake.spawnImpl });
assert.equal(result.models.length, 2);
assert.equal(result.capabilities.version, '1.2.3');
assert.equal(result.capabilities.appServerAvailable, true);
assert.equal(result.usage.rateLimitsByLimitId.codex_bengalfox.primary.usedPercent, 5);
assert.ok(!JSON.stringify(result).includes('secret-token'));
assert.deepEqual(fake.messages.map(message => message.method).sort(), ['initialize', 'initialized', 'model/list', 'model/list', 'account/rateLimits/read', 'mcpServerStatus/list'].sort());
assert.deepEqual(fake.kills, ['SIGTERM']);
for (const options of [{ timeout: true }, { rpcError: true }, { malformed: true }]) {
  const broken = fakeRuntime(options);
  const fallback = await probeCodexRuntime({ spawnImpl: broken.spawnImpl, timeoutMs: 10 });
  assert.deepEqual(fallback.models, []);
  assert.ok(!JSON.stringify(fallback).includes('secret-token'));
  assert.equal(broken.kills.length, 1);
}
const failedSpawn = await probeCodexRuntime({ spawnImpl: () => { throw new Error('secret-token'); } });
assert.deepEqual(failedSpawn.models, []);
assert.ok(!JSON.stringify(failedSpawn).includes('secret-token'));
console.log('Model policy and read-only runtime probe validation passed.');
