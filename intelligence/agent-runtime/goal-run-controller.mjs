import { NATIVE_GOAL_STATUSES } from './goal-lifecycle.mjs';

const THREAD_ID = /^[a-zA-Z0-9_.:/-]{1,200}$/;
const MAX_TRACKED_TURNS = 512;
const STATUS_SET = new Set(NATIVE_GOAL_STATUSES);
const NON_ACTIVE = new Set(['paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']);

function validThreadId(value) {
  if (typeof value !== 'string' || !THREAD_ID.test(value)) throw new TypeError('threadId is invalid');
  return value;
}

function deriveState({ nativeStatus, activeTurnId, stopRequested, recoveryRequired }) {
  if (recoveryRequired) return 'recoveryRequired';
  if (stopRequested && (activeTurnId || nativeStatus === 'active' || nativeStatus === null)) return 'stopping';
  if (activeTurnId && nativeStatus !== null && nativeStatus !== 'active') return 'stopping';
  if (activeTurnId) return 'running';
  if (nativeStatus === 'active') return 'waiting';
  if (nativeStatus === 'complete') return 'complete';
  if (nativeStatus === 'paused') return 'paused';
  if (nativeStatus === 'blocked') return 'blocked';
  if (nativeStatus === 'usageLimited' || nativeStatus === 'budgetLimited') return nativeStatus;
  return 'starting';
}

/**
 * Tracks one native Goal run without creating a second Goal store or scheduler.
 * The runtime owns RPCs, process lifetime and write leases; this reducer only
 * accepts exact-thread Goal/turn events and decides whether settlement is safe.
 */
export function createGoalRunController({ threadId, initialStatus = null, staleTurnIds = [],
  recoveryRequired: initiallyRecoveryRequired = false, recoveryReason: initialRecoveryReason = null } = {}) {
  threadId = validThreadId(threadId);
  if (initialStatus !== null && !STATUS_SET.has(initialStatus)) throw new TypeError('initial Goal status is invalid');
  if (typeof initiallyRecoveryRequired !== 'boolean'
      || (initialRecoveryReason !== null && (typeof initialRecoveryReason !== 'string' || initialRecoveryReason.length > 120))
      || (initiallyRecoveryRequired && initialStatus === null)
      || !Array.isArray(staleTurnIds) || staleTurnIds.length > MAX_TRACKED_TURNS
      || staleTurnIds.some(id => typeof id !== 'string' || !id || id.length > 200)) {
    throw new TypeError('initial Goal recovery state is invalid');
  }

  let nativeStatus = initialStatus;
  let activeTurnId = null;
  let stopRequested = false;
  let recoveryRequired = initiallyRecoveryRequired;
  let recoveryReason = initiallyRecoveryRequired ? (initialRecoveryReason ?? 'runtime-restarted') : null;
  const seenTurnIds = new Set();
  const completedTurnIds = new Set();
  const staleTurns = new Set(staleTurnIds);

  const snapshot = () => Object.freeze({
    nativeStatus,
    turnInFlight: activeTurnId !== null,
    state: deriveState({ nativeStatus, activeTurnId, stopRequested, recoveryRequired }),
    stopRequested,
    recoveryRequired,
    recoveryReason,
    turnsSeen: seenTurnIds.size,
    turnsCompleted: completedTurnIds.size,
    canSettle: nativeStatus !== null && nativeStatus !== 'active' && activeTurnId === null && !recoveryRequired
  });

  const reject = reason => {
    recoveryRequired = true;
    recoveryReason = reason;
    return Object.freeze({ accepted: false, reason, snapshot: snapshot() });
  };

  function observeStatus(status, eventThreadId = threadId) {
    if (recoveryRequired) return Object.freeze({ accepted: false, reason: 'recovery-required', snapshot: snapshot() });
    if (eventThreadId !== threadId) return Object.freeze({ accepted: false, reason: 'foreign-thread', snapshot: snapshot() });
    if (!STATUS_SET.has(status)) return reject('unknown-goal-status');
    nativeStatus = status;
    return Object.freeze({ accepted: true, duplicate: false, snapshot: snapshot() });
  }

  function observe(event) {
    if (recoveryRequired) return Object.freeze({ accepted: false, reason: 'recovery-required', snapshot: snapshot() });
    if (!event || typeof event !== 'object' || typeof event.method !== 'string') {
      return reject('malformed-event');
    }
    const params = event.params ?? {};

    if (event.method === 'thread/goal/updated') {
      if (params.threadId && params.goal?.threadId && params.threadId !== params.goal.threadId) {
        return reject('goal-thread-identity-conflict');
      }
      const eventThreadId = params.threadId ?? params.goal?.threadId;
      if (typeof eventThreadId !== 'string' || !eventThreadId) return reject('goal-thread-id-missing');
      if (eventThreadId !== threadId) return Object.freeze({ accepted: false, reason: 'foreign-thread', snapshot: snapshot() });
      return observeStatus(params.goal?.status, eventThreadId);
    }

    if (event.method !== 'turn/started' && event.method !== 'turn/completed') {
      return Object.freeze({ accepted: false, reason: 'unhandled-event', snapshot: snapshot() });
    }

    if (params.threadId && params.turn?.threadId && params.threadId !== params.turn.threadId) {
      return reject('turn-thread-identity-conflict');
    }
    const eventThreadId = params.threadId ?? params.turn?.threadId;
    if (typeof eventThreadId !== 'string' || !eventThreadId) return reject('turn-thread-id-missing');
    if (eventThreadId !== threadId) return Object.freeze({ accepted: false, reason: 'foreign-thread', snapshot: snapshot() });
    if (params.turnId && params.turn?.id && params.turnId !== params.turn.id) {
      return reject('turn-identity-conflict');
    }
    const turnId = params.turnId ?? params.turn?.id;
    if (typeof turnId !== 'string' || !turnId) return reject('turn-id-missing');

    if (event.method === 'turn/started') {
      if (staleTurns.has(turnId)) return Object.freeze({ accepted: true, duplicate: true, snapshot: snapshot() });
      if (seenTurnIds.has(turnId)) return Object.freeze({ accepted: true, duplicate: true, snapshot: snapshot() });
      if (activeTurnId !== null) return reject('overlapping-turns');
      if (nativeStatus !== null && nativeStatus !== 'active') return reject('turn-started-while-goal-not-active');
      if (seenTurnIds.size >= MAX_TRACKED_TURNS) return reject('turn-tracking-capacity-exceeded');
      seenTurnIds.add(turnId);
      activeTurnId = turnId;
      return Object.freeze({ accepted: true, duplicate: false, snapshot: snapshot() });
    }

    if (staleTurns.has(turnId) || completedTurnIds.has(turnId))
      return Object.freeze({ accepted: true, duplicate: true, snapshot: snapshot() });
    if (!seenTurnIds.has(turnId) || activeTurnId !== turnId) return reject('unexpected-turn-completion');
    completedTurnIds.add(turnId);
    activeTurnId = null;
    return Object.freeze({ accepted: true, duplicate: false, snapshot: snapshot() });
  }

  function isDuplicateTurnStart(turnId) {
    return typeof turnId === 'string' && (staleTurns.has(turnId) || seenTurnIds.has(turnId));
  }

  function requestStop() {
    if (snapshot().canSettle) return snapshot();
    stopRequested = true;
    return snapshot();
  }

  return Object.freeze({ observe, observeStatus, isDuplicateTurnStart, requestStop, snapshot });
}
