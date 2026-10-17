import assert from 'node:assert/strict';
import { createUsageGuard } from '../intelligence/agent-runtime/usage-guard.mjs';
import { buildDeveloperInstructions } from '../intelligence/agent-runtime/runtime-policy.mjs';
import { buildOrchestrationPlan } from '../intelligence/orchestration-plan.mjs';
import { taskIntent } from '../intelligence/task-intent.mjs';
import { prepareTurnRouting } from '../intelligence/agent-runtime/turn-routing.mjs';
import { constrainReadOnlyPlan } from '../intelligence/agent-runtime/orchestration-context.mjs';

const guard = createUsageGuard({ maxToolCalls: 4 });
const tool = id => ({ method: 'item/started', params: { item: { id, type: 'mcpToolCall' } } });
assert.equal(guard.observe(tool('one')), null);
assert.equal(guard.observe(tool('one')), null);
assert.equal(guard.observe(tool('two')).action, 'checkpoint');
assert.equal(guard.observe(tool('three')), null);
assert.equal(guard.observe(tool('four')).action, 'stop');
assert.equal(guard.observe(tool('four')), null);
assert.equal(guard.snapshot().observedToolCalls, 4);
assert.equal(guard.snapshot().modelTurns, null);
assert.equal(guard.snapshot().stopReason, 'tool-limit');
const contextGuard = createUsageGuard();
const event = { method: 'thread/tokenUsage/updated', params: { tokenUsage: {
  last: { inputTokens: 65000 }, total: { inputTokens: 1000000, cachedInputTokens: 900000, outputTokens: 5000 }
} } };
assert.equal(contextGuard.observe(event).action, 'stop');
assert.equal(contextGuard.snapshot().threadInputTokens, 1000000);
assert.equal(contextGuard.snapshot().stopReason, 'context-limit');
assert.equal(contextGuard.snapshot().maxContextTokens, 64000);
assert.equal(contextGuard.observe(event), null);
assert.equal(contextGuard.snapshot().threadInputTokens, 1000000);
const plan = buildOrchestrationPlan({ query: 'Fix README typo', moduleId: 'totem-remnant' });
const observed = createUsageGuard({ mode: 'observe' });
assert.equal(observed.observe(event).action, 'checkpoint');
for (let i = 0; i < 100; i++) assert.equal(observed.observe(tool(`observed-${i}`)), null);
assert.equal(observed.snapshot().stopped, false);
assert.equal(observed.snapshot().observedToolCalls, 100);
assert.equal(observed.snapshot().mode, 'observe');
assert.throws(() => createUsageGuard({ mode: 'off' }), /must be enforce or observe/);
const observeInstructions = buildDeveloperInstructions({ usageGuardMode: 'observe' });
assert.match(observeInstructions, /host owner selected warning-only/);
assert.doesNotMatch(observeInstructions, /at 80 calls or 64K stop/);
assert.match(observeInstructions, /sandbox, approvals, validation and release gates remain in force/);
assert.match(buildDeveloperInstructions(), /at 80 calls or 64K stop/);
assert.deepEqual(plan.affectedModules, ['totem-remnant']);
assert.equal(plan.waves.length, 1);
assert.equal(plan.execution.sharedContractStabilizationRequired, false);
assert.equal(plan.contextHints.modelPreference, 'lightweight-preferred');
const unknown = buildOrchestrationPlan({ query: 'typo in README' });
assert.equal(unknown.writeScope.length, 0);
const readOnly = buildOrchestrationPlan({ query: 'Show TotemCore configuration' });
assert.deepEqual(readOnly.affectedModules, ['totem-core']);
assert.equal(readOnly.writeScope.length, 0);
assert.ok(readOnly.waves.every(wave => !wave.writeAllowed));
assert.equal(taskIntent('fix README typo and delete implementation').documentationOnly, false);
assert.ok(buildOrchestrationPlan({ query: 'fix TotemCore README typo and delete implementation' }).writeScope.some(scope => scope.moduleId === 'totem-core'));
const production = buildOrchestrationPlan({ query: 'Fix README typo', moduleId: 'totem-core', changedFiles: ['TotemCore/src/main/Api.java'] });
assert.ok(production.execution.sharedContractStabilizationRequired);
const instructions = buildDeveloperInstructions({ plan: { ...plan, query: 'DO_NOT_DUPLICATE_QUERY', rationale: { redundant: 'x'.repeat(10000) } } });
assert.ok(!instructions.includes('DO_NOT_DUPLICATE_QUERY'));
assert.ok(!instructions.includes('x'.repeat(10000)));
assert.ok(instructions.includes('TotemRemnant/**'));
assert.ok(instructions.includes('fork_turns="none"'));
const priorDevelopment = { query: '繼續開發 TotemLumen renderer U2', resumed: true, contextTokens: 12000 };
for (const text of [
  '看一下最近還有沒有input過多的問題',
  '檢查一下現在消耗的token數量是否正常',
  '那幫我重啟dc服務',
  '我現在開發到哪了？',
  'Show current token usage'
]) {
  const routing = prepareTurnRouting({ text, state: priorDevelopment });
  assert.equal(routing.classification, 'operational', text);
  assert.equal(routing.followup, false, text);
  assert.equal(routing.query, text, text);
  assert.ok(!routing.query.includes('TotemLumen'), text);
  const operationalPlan = buildOrchestrationPlan({ query: routing.query, moduleId: 'totem-workspace' });
  assert.deepEqual(operationalPlan.affectedModules, ['totem-workspace'], text);
  assert.deepEqual(operationalPlan.writeScope, [], text);
  assert.ok(operationalPlan.waves.every(wave => !wave.writeAllowed), text);
}
const ambiguousRouting = prepareTurnRouting({ text: '還有能改善的地方嗎', state: priorDevelopment });
assert.equal(ambiguousRouting.classification, 'ambiguous');
assert.equal(ambiguousRouting.followup, false);
assert.equal(ambiguousRouting.query, '還有能改善的地方嗎');
const ambiguousPlan = constrainReadOnlyPlan(buildOrchestrationPlan({ query: ambiguousRouting.query }));
assert.deepEqual(ambiguousPlan.writeScope, []);
assert.equal(ambiguousPlan.execution.maxConcurrentWrites, 0);
assert.ok(ambiguousPlan.waves.every(wave => !wave.writeAllowed));
const continuationRouting = prepareTurnRouting({ text: '繼續', state: priorDevelopment });
assert.equal(continuationRouting.classification, 'continuation');
assert.equal(continuationRouting.followup, true);
assert.match(continuationRouting.query, /TotemLumen renderer U2\n繼續/);
for (const text of ['update it', 'add that', 'delete this']) {
  const contextualRouting = prepareTurnRouting({ text, state: priorDevelopment });
  assert.equal(contextualRouting.classification, 'continuation', text);
  assert.match(contextualRouting.query, /TotemLumen renderer U2/, text);
}
for (const text of ['Can you also add tests?', 'Then update the validator', '那再修改測試']) {
  const contextualRouting = prepareTurnRouting({ text, state: priorDevelopment });
  assert.equal(contextualRouting.classification, 'continuation', text);
  assert.match(contextualRouting.query, /TotemLumen renderer U2/, text);
}
const developmentRouting = prepareTurnRouting({ text: '新增 routing 測試', state: priorDevelopment });
assert.equal(developmentRouting.classification, 'development');
assert.equal(developmentRouting.followup, false);
for (const text of ['Assess TotemLumen lifecycle', 'Find the renderer test', 'Read the runtime config',
  'Explain the checkpoint schema', 'Locate the RGB profiler']) {
  const explicitRouting = prepareTurnRouting({ text, state: priorDevelopment });
  assert.equal(explicitRouting.classification, 'development', text);
  assert.ok(!explicitRouting.query.includes(priorDevelopment.query), text);
}
for (const text of ['查看 TotemLumen 開發進度後繼續開發', '查看 TotemLumen 開發進度並修復關閉崩潰']) {
  const mixedRouting = prepareTurnRouting({ text, state: priorDevelopment });
  assert.equal(mixedRouting.classification, 'development', text);
  assert.equal(mixedRouting.followup, false, text);
}
console.log('Usage guard, bounded routing and compact runtime instructions passed.');
