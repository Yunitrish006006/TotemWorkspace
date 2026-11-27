import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalRunController } from '../../../intelligence/agent-runtime/goal-run-controller.mjs';

const status = (value, threadId = 'thread-1') => ({
  method: 'thread/goal/updated', params: { threadId, goal: { threadId, status: value } }
});
const started = (turnId, threadId = 'thread-1') => ({
  method: 'turn/started', params: { threadId, turn: { id: turnId, threadId } }
});
const completed = (turnId, threadId = 'thread-1', turnStatus = 'completed') => ({
  method: 'turn/completed', params: { threadId, turn: { id: turnId, threadId, status: turnStatus } }
});

test('native active completion becomes waiting instead of run completion', () => {
  const controller = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  const running = controller.observe(started('turn-1')).snapshot;
  assert.equal(running.state, 'running');
  assert.equal(running.turnInFlight, true);
  assert.equal(Object.hasOwn(running, 'threadId'), false);
  assert.equal(Object.hasOwn(running, 'activeTurnId'), false);
  const afterTurn = controller.observe(completed('turn-1')).snapshot;
  assert.equal(afterTurn.state, 'waiting');
  assert.equal(afterTurn.canSettle, false);
});

test('settlement waits for both terminal native Goal state and no in-flight turn', () => {
  const controller = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  controller.observe(started('turn-1'));
  const terminalFirst = controller.observe(status('complete')).snapshot;
  assert.equal(terminalFirst.state, 'stopping');
  assert.equal(terminalFirst.canSettle, false);
  const noTurn = controller.observe(completed('turn-1')).snapshot;
  assert.equal(noTurn.state, 'complete');
  assert.equal(noTurn.canSettle, true);

  const turnFirst = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  turnFirst.observe(started('turn-a'));
  assert.equal(turnFirst.observe(completed('turn-a')).snapshot.canSettle, false);
  assert.equal(turnFirst.observe(status('paused')).snapshot.canSettle, true);
});

test('duplicate turn notifications are idempotent and cannot reopen completed turns', () => {
  const controller = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  assert.equal(controller.observe(started('turn-1')).snapshot.turnsSeen, 1);
  assert.equal(controller.observe(started('turn-1')).duplicate, true);
  assert.equal(controller.observe(completed('turn-1')).snapshot.turnsCompleted, 1);
  assert.equal(controller.observe(completed('turn-1')).duplicate, true);
  assert.equal(controller.snapshot().state, 'waiting');
});

test('foreign, overlapping, missing-ID and unexpected completion events fail closed', () => {
  const foreign = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  assert.equal(foreign.observe(started('turn-foreign', 'thread-2')).reason, 'foreign-thread');
  assert.equal(foreign.snapshot().recoveryRequired, false);

  const overlapping = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  overlapping.observe(started('turn-1'));
  assert.equal(overlapping.observe(started('turn-2')).reason, 'overlapping-turns');
  assert.equal(overlapping.snapshot().state, 'recoveryRequired');

  const missing = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  assert.equal(missing.observe({ method: 'turn/started', params: { threadId: 'thread-1' } }).reason, 'turn-id-missing');

  const missingThread = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  assert.equal(missingThread.observe({ method: 'turn/started', params: { turn: { id: 'turn-1' } } }).reason,
    'turn-thread-id-missing');
  assert.equal(missingThread.observe({ method: 'thread/goal/updated', params: { goal: { status: 'complete' } } }).reason,
    'recovery-required');
  const missingGoalThread = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  assert.equal(missingGoalThread.observe({ method: 'thread/goal/updated', params: { goal: { status: 'complete' } } }).reason,
    'goal-thread-id-missing');

  const unexpected = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  assert.equal(unexpected.observe(completed('turn-unknown')).reason, 'unexpected-turn-completion');
});

test('conflicting outer and nested thread/turn IDs cannot advance state', () => {
  const turnThreadConflict = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  assert.equal(turnThreadConflict.observe({ method: 'turn/started', params: {
    threadId: 'thread-1', turn: { id: 'turn-1', threadId: 'thread-2' }
  } }).reason, 'turn-thread-identity-conflict');
  assert.equal(turnThreadConflict.snapshot().turnInFlight, false);

  const goalThreadConflict = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  assert.equal(goalThreadConflict.observe({ method: 'thread/goal/updated', params: {
    threadId: 'thread-1', goal: { threadId: 'thread-2', status: 'complete' }
  } }).reason, 'goal-thread-identity-conflict');
  assert.equal(goalThreadConflict.snapshot().canSettle, false);

  const turnIdConflict = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  assert.equal(turnIdConflict.observe({ method: 'turn/started', params: {
    threadId: 'thread-1', turnId: 'turn-outer', turn: { id: 'turn-inner', threadId: 'thread-1' }
  } }).reason, 'turn-identity-conflict');
  assert.equal(turnIdConflict.snapshot().turnInFlight, false);
});

test('native stop statuses settle only after the active turn completes', () => {
  for (const nativeStatus of ['paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']) {
    const controller = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
    controller.observe(started('turn-1'));
    const stopped = controller.observe(status(nativeStatus)).snapshot;
    assert.equal(stopped.canSettle, false, `${nativeStatus} with an in-flight turn`);
    assert.equal(controller.observe(completed('turn-1')).snapshot.canSettle, true, nativeStatus);
  }
});

test('native status and turn matrix keeps active runs open and terminal runs settle only without a turn', () => {
  for (const nativeStatus of ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']) {
    const controller = createGoalRunController({ threadId: 'thread-1', initialStatus: nativeStatus });
    const initial = controller.snapshot();
    assert.equal(initial.canSettle, nativeStatus !== 'active', `${nativeStatus} without a turn`);
    assert.equal(initial.state, nativeStatus === 'active' ? 'waiting' : nativeStatus);

    if (nativeStatus === 'active') {
      assert.equal(controller.observe(started('turn-1')).snapshot.canSettle, false);
      assert.equal(controller.observe(completed('turn-1')).snapshot.state, 'waiting');
      assert.equal(controller.snapshot().canSettle, false);
      continue;
    }

    assert.equal(controller.observe(started('unexpected-turn')).reason, 'turn-started-while-goal-not-active');
    assert.equal(controller.snapshot().state, 'recoveryRequired');
  }
});

test('stop request remains stopping until native status and in-flight turn settle', () => {
  const controller = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  controller.observe(started('turn-1'));
  assert.equal(controller.requestStop().state, 'stopping');
  assert.equal(controller.observe(completed('turn-1')).snapshot.canSettle, false);
  assert.equal(controller.observe(status('paused')).snapshot.state, 'paused');
  assert.equal(controller.snapshot().canSettle, true);
});

test('unknown Goal statuses become recoveryRequired and invalid thread IDs reject', () => {
  const controller = createGoalRunController({ threadId: 'thread-1' });
  assert.equal(controller.observe(status('future-status')).reason, 'unknown-goal-status');
  assert.equal(controller.snapshot().state, 'recoveryRequired');
  assert.throws(() => createGoalRunController({ threadId: 'bad thread' }), TypeError);
});

test('a restarted runtime exposes the read native state as recoveryRequired and rejects delayed events', () => {
  const recovered = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active',
    recoveryRequired: true, recoveryReason: 'runtime-restarted' });
  const initial = recovered.snapshot();
  assert.equal(initial.nativeStatus, 'active');
  assert.equal(initial.state, 'recoveryRequired');
  assert.equal(initial.recoveryReason, 'runtime-restarted');
  assert.equal(initial.canSettle, false);

  for (const event of [started('old-turn'), completed('old-turn'), status('complete')]) {
    const result = recovered.observe(event);
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'recovery-required');
  }
  assert.equal(recovered.observeStatus('complete').reason, 'recovery-required');
  assert.deepEqual(recovered.snapshot(), initial, 'old turn and Goal events cannot mutate restarted state');
});

test('turn IDs read from the exact resumed thread are ignored as delayed prior-process events', () => {
  const resumed = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active',
    staleTurnIds: ['prior-turn-1', 'prior-turn-2'] });
  assert.equal(resumed.observe(started('prior-turn-1')).duplicate, true);
  assert.equal(resumed.observe(completed('prior-turn-1')).duplicate, true);
  assert.equal(resumed.snapshot().turnsSeen, 0);
  assert.equal(resumed.snapshot().turnInFlight, false);
  assert.equal(resumed.observe(started('fresh-turn')).snapshot.turnInFlight, true);
  assert.equal(resumed.observe(completed('fresh-turn')).snapshot.turnsCompleted, 1);
});

test('invalid initial recovery metadata rejects instead of weakening restart state', () => {
  assert.throws(() => createGoalRunController({ threadId: 'thread-1', recoveryRequired: 'true' }), TypeError);
  assert.throws(() => createGoalRunController({ threadId: 'thread-1', recoveryRequired: true,
    recoveryReason: 'x'.repeat(121) }), TypeError);
  assert.throws(() => createGoalRunController({ threadId: 'thread-1', recoveryRequired: true }), TypeError,
    'a restarted controller requires successfully read native Goal state');
});

test('turn identity tracking is bounded and fails closed at capacity', () => {
  const controller = createGoalRunController({ threadId: 'thread-1', initialStatus: 'active' });
  for (let i = 0; i < 512; i++) {
    assert.equal(controller.observe(started(`turn-${i}`)).accepted, true);
    assert.equal(controller.observe(completed(`turn-${i}`)).accepted, true);
  }
  assert.equal(controller.observe(started('turn-over-cap')).reason, 'turn-tracking-capacity-exceeded');
  assert.equal(controller.snapshot().state, 'recoveryRequired');
});
