import { createHash } from 'node:crypto';

const THREAD_ID = /^[a-zA-Z0-9_.:/-]{1,200}$/;
export const NATIVE_GOAL_STATUSES = Object.freeze(['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']);
const STATUS_SET = new Set(NATIVE_GOAL_STATUSES);
const NO_GOAL_REVISION = createHash('sha256').update('no-goal').digest('hex');

function validThreadId(value) {
  if (typeof value !== 'string' || !THREAD_ID.test(value)) throw new TypeError('threadId is invalid');
  return value;
}

function validateBudget(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('tokenBudget must be a positive safe integer');
  return value;
}

function validateObjective(value) {
  if (typeof value !== 'string') throw new TypeError('objective must be text');
  const objective = value.trim();
  if (!objective || objective.length > 4_000) throw new RangeError('objective must contain between 1 and 4000 characters');
  return objective;
}

function normalizeGoal(value, threadId) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.threadId !== threadId
      || typeof value.objective !== 'string' || !value.objective.trim()
      || !STATUS_SET.has(value.status)
      || (value.tokenBudget !== undefined && value.tokenBudget !== null
        && (!Number.isSafeInteger(value.tokenBudget) || value.tokenBudget < 1))
      || (value.tokensUsed !== undefined && value.tokensUsed !== null
        && (!Number.isSafeInteger(value.tokensUsed) || value.tokensUsed < 0))
      || (value.timeUsedSeconds !== undefined && value.timeUsedSeconds !== null
        && (!Number.isSafeInteger(value.timeUsedSeconds) || value.timeUsedSeconds < 0))) {
    throw Object.assign(new Error('Native Goal state is invalid or has an unknown status'), { code: 'GOAL_STATE_INVALID' });
  }
  return Object.freeze({ threadId, objective: value.objective, status: value.status,
    tokenBudget: Number.isSafeInteger(value.tokenBudget) ? value.tokenBudget : null,
    tokensUsed: Number.isSafeInteger(value.tokensUsed) ? value.tokensUsed : null,
    timeUsedSeconds: Number.isSafeInteger(value.timeUsedSeconds) ? value.timeUsedSeconds : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null });
}

function revisionOf(goal) {
  if (!goal) return NO_GOAL_REVISION;
  const stable = JSON.stringify([goal.threadId, goal.objective, goal.status, goal.tokenBudget,
    goal.tokensUsed, goal.timeUsedSeconds, goal.createdAt, goal.updatedAt]);
  return createHash('sha256').update(stable).digest('hex');
}

/** Computes the lifecycle revision for a raw native Goal read-back. */
export function nativeGoalRevision(value, threadId) {
  threadId = validThreadId(threadId);
  return revisionOf(normalizeGoal(value, threadId));
}

function assertRevision(current, expectedRevision) {
  if (typeof expectedRevision !== 'string' || expectedRevision !== current.revision) {
    throw Object.assign(new Error('Native Goal changed; refresh status before retrying'), { code: 'GOAL_REVISION_CONFLICT' });
  }
}

/** Serializes per-thread Goal mutations and treats App Server state as the source of truth. */
export function createGoalLifecycle({ client, supervisor = null } = {}) {
  if (!client || typeof client.getGoal !== 'function' || typeof client.setGoal !== 'function'
      || typeof client.clearGoal !== 'function') throw new TypeError('A bounded Goal RPC client is required');
  const chains = new Map();

  function serialize(threadId, operation) {
    const previous = chains.get(threadId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    chains.set(threadId, current);
    return current.finally(() => { if (chains.get(threadId) === current) chains.delete(threadId); });
  }

  async function read(threadId) {
    threadId = validThreadId(threadId);
    const result = await client.getGoal({ threadId });
    if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'goal') || result.goal === undefined) {
      throw Object.assign(new Error('Native Goal read returned no explicit state'), { code: 'GOAL_STATE_INVALID' });
    }
    const goal = normalizeGoal(result?.goal, threadId);
    return Object.freeze({ goal, revision: revisionOf(goal) });
  }

  async function requireExpected(threadId, expectedRevision) {
    const current = await read(threadId);
    assertRevision(current, expectedRevision);
    return current;
  }

  async function pause(threadId, expectedRevision) {
    threadId = validThreadId(threadId);
    return serialize(threadId, async () => {
      const current = await requireExpected(threadId, expectedRevision);
      if (!current.goal || current.goal.status !== 'active') return current;
      await client.setGoal({ threadId, status: 'paused' });
      const updated = await read(threadId);
      if (!updated.goal || updated.goal.status !== 'paused'
          || updated.goal.objective !== current.goal.objective
          || updated.goal.tokenBudget !== current.goal.tokenBudget
          || updated.goal.tokensUsed !== current.goal.tokensUsed
          || updated.goal.timeUsedSeconds !== current.goal.timeUsedSeconds
          || updated.goal.createdAt !== current.goal.createdAt) {
        throw Object.assign(new Error('Native Goal pause did not preserve the expected state'), { code: 'GOAL_READBACK_MISMATCH' });
      }
      return updated;
    });
  }

  async function setBudget(threadId, tokenBudget, expectedRevision) {
    threadId = validThreadId(threadId);
    tokenBudget = validateBudget(tokenBudget);
    return serialize(threadId, async () => {
      const current = await requireExpected(threadId, expectedRevision);
      if (!current.goal) throw Object.assign(new Error('No native Goal exists for this thread'), { code: 'GOAL_NOT_FOUND' });
      if (current.goal.status === 'budgetLimited') {
        if (!Number.isSafeInteger(current.goal.tokenBudget) || current.goal.tokenBudget < 1) {
          throw Object.assign(new Error('Native Goal token budget is unavailable'), { code: 'GOAL_STATE_INVALID' });
        }
        if (!Number.isSafeInteger(current.goal.tokensUsed)) {
          throw Object.assign(new Error('Native Goal token usage is unavailable'), { code: 'GOAL_USAGE_UNKNOWN' });
        }
        if (tokenBudget <= current.goal.tokenBudget || tokenBudget <= current.goal.tokensUsed) {
          throw Object.assign(new Error('New budget must exceed both the current budget and tokens used'), {
            code: 'GOAL_BUDGET_NOT_ABOVE_USAGE'
          });
        }
        if (typeof supervisor?.setBudget !== 'function') {
          throw Object.assign(new Error('Changing a budget-limited Goal requires the M7 supervisor to prevent implicit activation'), {
            code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
          });
        }
        const updated = await supervisor.setBudget({ threadId, tokenBudget, revision: current.revision });
        if (!updated?.goal || updated.goal.threadId !== threadId || updated.goal.tokenBudget !== tokenBudget
            || updated.goal.objective !== current.goal.objective
            || updated.goal.tokensUsed !== current.goal.tokensUsed
            || updated.goal.timeUsedSeconds !== current.goal.timeUsedSeconds
            || updated.goal.createdAt !== current.goal.createdAt
            || !['budgetLimited', 'paused', 'blocked', 'usageLimited', 'complete'].includes(updated.goal.status)) {
          throw Object.assign(new Error('Supervised Goal budget update changed unrelated state or resumed the Goal'), {
            code: 'GOAL_READBACK_MISMATCH'
          });
        }
        return updated;
      }
      if (current.goal.status !== 'paused') {
        throw Object.assign(new Error('Pause the native Goal before changing its budget'), { code: 'GOAL_MUST_BE_PAUSED' });
      }
      await client.setGoal({ threadId, tokenBudget });
      const updated = await read(threadId);
      if (!updated.goal || updated.goal.tokenBudget !== tokenBudget
          || updated.goal.objective !== current.goal.objective
          || updated.goal.tokensUsed !== current.goal.tokensUsed
          || updated.goal.timeUsedSeconds !== current.goal.timeUsedSeconds
          || updated.goal.createdAt !== current.goal.createdAt
          || updated.goal.status !== current.goal.status) {
        throw Object.assign(new Error('Native Goal budget update changed unrelated state'), { code: 'GOAL_READBACK_MISMATCH' });
      }
      return updated;
    });
  }

  async function clear(threadId, expectedRevision) {
    threadId = validThreadId(threadId);
    return serialize(threadId, async () => {
      const current = await requireExpected(threadId, expectedRevision);
      if (!current.goal) return current;
      if (current.goal.status === 'active') {
        throw Object.assign(new Error('Pause and stop the native Goal before clearing it'), { code: 'GOAL_MUST_BE_PAUSED' });
      }
      await client.clearGoal({ threadId });
      const updated = await read(threadId);
      if (updated.goal) throw Object.assign(new Error('Native Goal clear did not persist'), { code: 'GOAL_READBACK_MISMATCH' });
      return updated;
    });
  }

  async function activate(threadId, objective, tokenBudget, expectedRevision, { resume = false } = {}) {
    threadId = validThreadId(threadId);
    if (resume) {
      if (objective !== undefined && objective !== null) objective = validateObjective(objective);
    } else objective = validateObjective(objective);
    if (tokenBudget !== undefined) tokenBudget = validateBudget(tokenBudget);
    if (!supervisor || typeof supervisor.activate !== 'function') {
      throw Object.assign(new Error('Native Goal execution requires the M7 runtime supervisor'), { code: 'GOAL_SUPERVISOR_REQUIRED' });
    }
    return serialize(threadId, async () => {
      const current = await requireExpected(threadId, expectedRevision);
      if (resume) {
        if (!current.goal || !['paused', 'blocked', 'budgetLimited'].includes(current.goal.status)) {
          throw Object.assign(new Error('This native Goal is not in a resumable state'), { code: 'GOAL_NOT_RESUMABLE' });
        }
        if (objective !== undefined && objective !== null && current.goal.objective !== objective) {
          throw Object.assign(new Error('Resume cannot replace the native Goal objective'), { code: 'GOAL_OBJECTIVE_CONFLICT' });
        }
        if (current.goal.status === 'budgetLimited') {
          if (!Number.isSafeInteger(current.goal.tokenBudget) || current.goal.tokenBudget <= 0
              || !Number.isSafeInteger(current.goal.tokensUsed) || current.goal.tokensUsed < 0) {
            throw Object.assign(new Error('Cannot verify the native Goal token usage'), { code: 'GOAL_USAGE_UNKNOWN' });
          }
          if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= current.goal.tokenBudget
              || tokenBudget <= current.goal.tokensUsed) {
            throw Object.assign(new Error('Increase the native Goal budget explicitly before resuming'), { code: 'GOAL_BUDGET_CHANGE_REQUIRED' });
          }
        }
      } else if (current.goal && current.goal.status !== 'complete') {
        throw Object.assign(new Error('A native Goal already exists for this thread'), { code: 'GOAL_ALREADY_EXISTS' });
      }
      return supervisor.activate({ threadId, objective: resume ? current.goal.objective : objective,
        ...(tokenBudget === undefined ? {} : { tokenBudget }),
        revision: current.revision, resume });
    });
  }

  return Object.freeze({ get: read, pause, setBudget, clear, activate });
}

export { NO_GOAL_REVISION };
