import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalLifecycle, NATIVE_GOAL_STATUSES, NO_GOAL_REVISION } from '../../../intelligence/agent-runtime/goal-lifecycle.mjs';

function fakeNativeGoal(initial = null, { mutateOnSet = null } = {}) {
  let goal = initial ? { ...initial } : null;
  const calls = [];
  const client = {
    getGoal: async params => { calls.push(['get', params]); return { goal: goal ? { ...goal } : null }; },
    setGoal: async params => {
      calls.push(['set', params]);
      if (!goal) goal = { threadId: params.threadId, objective: params.objective, status: params.status ?? 'active',
        tokenBudget: params.tokenBudget ?? null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 'created', updatedAt: 'updated' };
      else {
        const updated = { ...goal, ...params, updatedAt: `${goal.updatedAt}!` };
        goal = mutateOnSet ? mutateOnSet(updated, params) : updated;
      }
      return {};
    },
    clearGoal: async params => { calls.push(['clear', params]); goal = null; return {}; }
  };
  return { client, calls, get goal() { return goal; } };
}

const pausedGoal = () => ({ threadId: 'thread-1', objective: 'Complete the bounded task', status: 'paused',
  tokenBudget: 5000, tokensUsed: 420, timeUsedSeconds: 12, createdAt: 'created', updatedAt: 'updated' });

test('native Goal get reads the single source of truth and recognizes every protocol status', async () => {
  for (const status of NATIVE_GOAL_STATUSES) {
    const native = fakeNativeGoal({ ...pausedGoal(), status });
    const adapter = createGoalLifecycle({ client: native.client });
    const result = await adapter.get('thread-1');
    assert.equal(result.goal.status, status);
    assert.match(result.revision, /^[a-f0-9]{64}$/);
  }
  const absent = await createGoalLifecycle({ client: fakeNativeGoal().client }).get('thread-1');
  assert.equal(absent.goal, null);
  assert.equal(absent.revision, NO_GOAL_REVISION);
});

test('unknown native Goal status and malformed state fail closed', async () => {
  const unknown = fakeNativeGoal({ ...pausedGoal(), status: 'futureStatus' });
  await assert.rejects(createGoalLifecycle({ client: unknown.client }).get('thread-1'), { code: 'GOAL_STATE_INVALID' });
  const wrongThread = fakeNativeGoal({ ...pausedGoal(), threadId: 'other-thread' });
  await assert.rejects(createGoalLifecycle({ client: wrongThread.client }).get('thread-1'), { code: 'GOAL_STATE_INVALID' });
});

test('objective, budget and thread ID inputs are bounded before any supervisor/RPC call', async () => {
  const native = fakeNativeGoal();
  const adapter = createGoalLifecycle({ client: native.client });
  await assert.rejects(adapter.get('thread id'), TypeError);
  await assert.rejects(adapter.activate('thread-1', '  ', undefined, NO_GOAL_REVISION), RangeError);
  await assert.rejects(adapter.activate('thread-1', 'x'.repeat(4001), undefined, NO_GOAL_REVISION), RangeError);
  await assert.rejects(adapter.activate('thread-1', 'objective', null, NO_GOAL_REVISION), RangeError);
  assert.equal(native.calls.some(([kind]) => kind !== 'get'), false);
});

test('pause changes only native status and verifies objective, budget and usage by reading back', async () => {
  const native = fakeNativeGoal(pausedGoal());
  native.goal.status = 'active';
  const adapter = createGoalLifecycle({ client: native.client });
  const before = await adapter.get('thread-1');
  const after = await adapter.pause('thread-1', before.revision);
  assert.equal(after.goal.status, 'paused');
  assert.equal(after.goal.objective, 'Complete the bounded task');
  assert.equal(after.goal.tokenBudget, 5000);
  assert.equal(after.goal.tokensUsed, 420);
  assert.deepEqual(native.calls.filter(([kind]) => kind === 'set').map(([, params]) => params), [
    { threadId: 'thread-1', status: 'paused' }
  ]);

  const limited = fakeNativeGoal({ ...pausedGoal(), status: 'budgetLimited' });
  const limitedAdapter = createGoalLifecycle({ client: limited.client });
  const limitedState = await limitedAdapter.get('thread-1');
  const limitedResult = await limitedAdapter.pause('thread-1', limitedState.revision);
  assert.equal(limitedResult.goal.status, 'budgetLimited');
  assert.equal(limited.calls.some(([kind]) => kind === 'set'), false);
});

test('same-thread Goal mutations serialize and only one stale-revision pause commits', async () => {
  const native = fakeNativeGoal({ ...pausedGoal(), status: 'active' });
  const adapter = createGoalLifecycle({ client: native.client });
  const before = await adapter.get('thread-1');
  const results = await Promise.allSettled([
    adapter.pause('thread-1', before.revision),
    adapter.pause('thread-1', before.revision)
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'GOAL_REVISION_CONFLICT');
  assert.equal(native.calls.filter(([kind]) => kind === 'set').length, 1);
});

test('budget changes require a current paused Goal and omit objective/status/null fields', async () => {
  const native = fakeNativeGoal(pausedGoal());
  const adapter = createGoalLifecycle({ client: native.client });
  const before = await adapter.get('thread-1');
  const after = await adapter.setBudget('thread-1', 9000, before.revision);
  assert.equal(after.goal.tokenBudget, 9000);
  assert.equal(after.goal.tokensUsed, 420);
  assert.equal(after.goal.status, 'paused');
  assert.deepEqual(native.calls.find(([kind]) => kind === 'set')[1], { threadId: 'thread-1', tokenBudget: 9000 });
  await assert.rejects(adapter.setBudget('thread-1', null, after.revision), RangeError);
  await assert.rejects(adapter.setBudget('thread-1', 10000, before.revision), { code: 'GOAL_REVISION_CONFLICT' });
  const active = fakeNativeGoal({ ...pausedGoal(), status: 'active' });
  const activeAdapter = createGoalLifecycle({ client: active.client });
  const activeState = await activeAdapter.get('thread-1');
  await assert.rejects(activeAdapter.setBudget('thread-1', 10000, activeState.revision), { code: 'GOAL_MUST_BE_PAUSED' });

  const limited = fakeNativeGoal({ ...pausedGoal(), status: 'budgetLimited' });
  const limitedAdapter = createGoalLifecycle({ client: limited.client });
  const limitedState = await limitedAdapter.get('thread-1');
  await assert.rejects(limitedAdapter.setBudget('thread-1', 9000, limitedState.revision),
    { code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED' });
  assert.equal(limited.calls.some(([kind]) => kind === 'set'), false);

  const supervisorCalls = [];
  let controlledAdapter;
  controlledAdapter = createGoalLifecycle({ client: limited.client, supervisor: {
    setBudget: async args => {
      supervisorCalls.push(args);
      await limited.client.setGoal({ threadId: args.threadId, tokenBudget: args.tokenBudget });
      return controlledAdapter.get(args.threadId);
    }
  } });
  const controlled = await controlledAdapter.setBudget('thread-1', 9000, limitedState.revision);
  assert.equal(controlled.goal.tokenBudget, 9000);
  assert.equal(controlled.goal.status, 'budgetLimited');
  assert.equal(controlled.goal.tokensUsed, pausedGoal().tokensUsed);
  assert.deepEqual(supervisorCalls, [{ threadId: 'thread-1', tokenBudget: 9000, revision: limitedState.revision }]);
  assert.equal(limited.calls.filter(([kind]) => kind === 'set').length, 1);

  const autoActivated = fakeNativeGoal({ ...pausedGoal(), status: 'budgetLimited' });
  let autoActivatedAdapter;
  autoActivatedAdapter = createGoalLifecycle({ client: autoActivated.client, supervisor: {
    setBudget: async ({ threadId, tokenBudget }) => {
      autoActivated.goal.tokenBudget = tokenBudget;
      autoActivated.goal.status = 'active';
      return autoActivatedAdapter.get(threadId);
    }
  } });
  const autoActivatedState = await autoActivatedAdapter.get('thread-1');
  await assert.rejects(autoActivatedAdapter.setBudget('thread-1', 9000, autoActivatedState.revision),
    { code: 'GOAL_READBACK_MISMATCH' }, 'supervisor must not report a budget update that leaves the Goal active');
});

test('pause and budget readback reject changes to elapsed-time and Goal identity fields', async () => {
  const mutateTime = goal => ({ ...goal, timeUsedSeconds: goal.timeUsedSeconds + 1 });
  const active = fakeNativeGoal({ ...pausedGoal(), status: 'active' }, { mutateOnSet: mutateTime });
  const activeAdapter = createGoalLifecycle({ client: active.client });
  const activeState = await activeAdapter.get('thread-1');
  await assert.rejects(activeAdapter.pause('thread-1', activeState.revision), { code: 'GOAL_READBACK_MISMATCH' });

  const paused = fakeNativeGoal(pausedGoal(), { mutateOnSet: mutateTime });
  const pausedAdapter = createGoalLifecycle({ client: paused.client });
  const pausedState = await pausedAdapter.get('thread-1');
  await assert.rejects(pausedAdapter.setBudget('thread-1', 7000, pausedState.revision), { code: 'GOAL_READBACK_MISMATCH' });

  const mutateCreatedAt = goal => ({ ...goal, createdAt: 'unexpected-created-time' });
  const created = fakeNativeGoal({ ...pausedGoal(), status: 'active' }, { mutateOnSet: mutateCreatedAt });
  const createdAdapter = createGoalLifecycle({ client: created.client });
  const createdState = await createdAdapter.get('thread-1');
  await assert.rejects(createdAdapter.pause('thread-1', createdState.revision), { code: 'GOAL_READBACK_MISMATCH' });
});

test('clear is idempotent, revision guarded and refuses active Goals', async () => {
  const none = fakeNativeGoal();
  const noneAdapter = createGoalLifecycle({ client: none.client });
  assert.equal((await noneAdapter.clear('thread-1', NO_GOAL_REVISION)).goal, null);
  assert.equal(none.calls.some(([kind]) => kind === 'clear'), false);

  const active = fakeNativeGoal({ ...pausedGoal(), status: 'active' });
  const activeAdapter = createGoalLifecycle({ client: active.client });
  const activeState = await activeAdapter.get('thread-1');
  await assert.rejects(activeAdapter.clear('thread-1', activeState.revision), { code: 'GOAL_MUST_BE_PAUSED' });
  assert.equal(active.calls.some(([kind]) => kind === 'clear'), false);

  const paused = fakeNativeGoal(pausedGoal());
  const adapter = createGoalLifecycle({ client: paused.client });
  const current = await adapter.get('thread-1');
  assert.equal((await adapter.clear('thread-1', current.revision)).goal, null);
  assert.deepEqual(paused.calls.find(([kind]) => kind === 'clear')[1], { threadId: 'thread-1' });
});

test('clear RPC failure and stale clear read-back preserve the last known Goal state', async () => {
  const rpcFailure = fakeNativeGoal(pausedGoal());
  rpcFailure.client.clearGoal = async () => { throw new Error('clear RPC denied'); };
  const rpcAdapter = createGoalLifecycle({ client: rpcFailure.client });
  const rpcState = await rpcAdapter.get('thread-1');
  await assert.rejects(rpcAdapter.clear('thread-1', rpcState.revision), /clear RPC denied/);
  assert.equal((await rpcAdapter.get('thread-1')).goal.status, 'paused');

  const readbackFailure = fakeNativeGoal(pausedGoal());
  readbackFailure.client.clearGoal = async () => {};
  const readbackAdapter = createGoalLifecycle({ client: readbackFailure.client });
  const readbackState = await readbackAdapter.get('thread-1');
  await assert.rejects(readbackAdapter.clear('thread-1', readbackState.revision), { code: 'GOAL_READBACK_MISMATCH' });
  assert.equal((await readbackAdapter.get('thread-1')).goal.status, 'paused');
});

test('clear requires an explicit null Goal read-back and rejects omitted or undefined state', async () => {
  for (const malformedRead of [{}, { goal: undefined }]) {
    let reads = 0;
    let clears = 0;
    const client = {
      getGoal: async () => ++reads <= 2 ? { goal: pausedGoal() } : malformedRead,
      setGoal: async () => {},
      clearGoal: async () => { clears++; }
    };
    const adapter = createGoalLifecycle({ client });
    const current = await adapter.get('thread-1');
    await assert.rejects(adapter.clear('thread-1', current.revision), { code: 'GOAL_STATE_INVALID' });
    assert.equal(clears, 1);
    assert.equal(reads, 3);
  }
});

test('new or resumed active Goals require the M7 supervisor and never mutate directly', async () => {
  const native = fakeNativeGoal();
  const adapter = createGoalLifecycle({ client: native.client });
  await assert.rejects(adapter.activate('thread-1', 'A new bounded objective', undefined, NO_GOAL_REVISION),
    { code: 'GOAL_SUPERVISOR_REQUIRED' });
  assert.equal(native.calls.some(([kind]) => kind === 'set'), false);

  const calls = [];
  const supervised = createGoalLifecycle({ client: native.client,
    supervisor: { activate: async args => { calls.push(args); return { accepted: true }; } } });
  const started = await supervised.activate('thread-1', 'A new bounded objective', undefined, NO_GOAL_REVISION);
  assert.deepEqual(started, { accepted: true });
  assert.deepEqual(calls[0], { threadId: 'thread-1', objective: 'A new bounded objective', revision: NO_GOAL_REVISION, resume: false });

  const paused = fakeNativeGoal(pausedGoal());
  const pausedState = await createGoalLifecycle({ client: paused.client }).get('thread-1');
  const resumeAdapter = createGoalLifecycle({ client: paused.client,
    supervisor: { activate: async args => { calls.push(args); return { accepted: true }; } } });
  await resumeAdapter.activate('thread-1', undefined, undefined, pausedState.revision, { resume: true });
  assert.equal(calls[1].objective, pausedGoal().objective);
  assert.equal(calls[1].resume, true);

  const limited = fakeNativeGoal({ ...pausedGoal(), status: 'budgetLimited' });
  const limitedState = await createGoalLifecycle({ client: limited.client }).get('thread-1');
  const limitedAdapter = createGoalLifecycle({ client: limited.client,
    supervisor: { activate: async args => args } });
  await assert.rejects(limitedAdapter.activate('thread-1', undefined, undefined, limitedState.revision, { resume: true }),
    { code: 'GOAL_BUDGET_CHANGE_REQUIRED' });
});

test('budgetLimited lifecycle resume requires known current budget and token usage', async () => {
  for (const unknownField of ['tokensUsed', 'tokenBudget']) {
    const value = fakeNativeGoal({ ...pausedGoal(), status: 'budgetLimited', [unknownField]: null });
    let activations = 0;
    const adapter = createGoalLifecycle({ client: value.client, supervisor: {
      activate: async () => { activations++; }
    } });
    const state = await adapter.get('thread-1');
    await assert.rejects(adapter.activate('thread-1', undefined, 9000, state.revision, { resume: true }),
      { code: 'GOAL_USAGE_UNKNOWN' });
    assert.equal(activations, 0, `${unknownField} must not reach the activation supervisor`);
    assert.equal(value.calls.some(([kind]) => kind === 'set'), false);
  }
});
