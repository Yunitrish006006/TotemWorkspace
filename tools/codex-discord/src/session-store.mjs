import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from 'node:crypto';
import path from "node:path";

const checkpointNumber = value => value != null && !(typeof value === "string" && !value.trim())
  && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : null;
const THREAD_SOURCES = new Set(['cli', 'vscode', 'appServer', 'unknown']);

function boundedId(value, limit = 200) {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]+$/.test(value) && value.length <= limit ? value : null;
}

function threadId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(value) ? value : null;
}

function validPendingBinding(value) {
  return value?.schemaVersion === 2 && value.sessionId === null && value.origin === 'native-selection'
    && typeof value.workspace === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value.workspace)
    && THREAD_SOURCES.has(value.source)
    && threadId(value.sourceThreadId) && threadId(value.sourceLastCompletedTurnId)
    && (value.sourceUpdatedAt === undefined || Number.isFinite(value.sourceUpdatedAt))
    && value.selectionMode === 'fork' && Number.isSafeInteger(value.selectionRevision)
    && value.selectionRevision >= 1 && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt));
}

function checkpointPath(value) {
  if (typeof value !== "string" || value.length > 512 || path.isAbsolute(value)) return null;
  const normalized = value.replaceAll("\\", "/");
  return normalized.split("/").includes("..") ? null : normalized;
}

function sanitizeCheckpoint(value) {
  const id = boundedId(value?.id);
  if (!id) return null;
  const usage = value?.usage ?? {};
  const stopped = value?.state === "stopped" || usage.action === "stop";
  const filesChanged = [...new Set((Array.isArray(value?.filesChanged) ? value.filesChanged : [])
    .map(checkpointPath).filter(Boolean))].slice(0, 120);
  return Object.freeze({
    schemaVersion: 1,
    id,
    updatedAt: typeof value?.updatedAt === "string" && value.updatedAt.length <= 64
      ? value.updatedAt : new Date().toISOString(),
    sessionId: boundedId(value?.sessionId),
    workspace: boundedId(value?.workspace, 120),
    state: stopped ? "stopped" : "in-progress",
    branch: typeof value?.branch === "string" ? value.branch.slice(0, 200) : null,
    head: typeof value?.head === "string" && /^[a-f0-9]{7,64}$/i.test(value.head) ? value.head : null,
    worktreeDigest: typeof value?.worktreeDigest === "string" && /^[a-f0-9]{64}$/i.test(value.worktreeDigest)
      ? value.worktreeDigest : null,
    filesChanged,
    validation: Object.freeze([{ type: "usage-budget", status: stopped ? "stopped" : "checkpoint",
      summary: stopped ? "Runtime stopped at the local usage budget." : "Runtime usage checkpoint recorded at local budget pressure." }]),
    usage: Object.freeze({
      observedToolCalls: checkpointNumber(usage.observedToolCalls),
      firstContext: checkpointNumber(usage.firstContext),
      peakContext: checkpointNumber(usage.peakContext),
      threadInputTokens: checkpointNumber(usage.threadInputTokens),
      threadCachedInputTokens: checkpointNumber(usage.threadCachedInputTokens),
      threadOutputTokens: checkpointNumber(usage.threadOutputTokens)
    }),
    remainingRisks: Object.freeze(stopped ? ["Runtime turn stopped before completing the requested task."]
      : ["Runtime turn remains active after this checkpoint."]),
    nextTask: null,
    summary: stopped ? "Runtime stop checkpoint saved at the local usage budget."
      : "Runtime progress checkpoint saved at local budget pressure."
  });
}

export function sessionKey({ userId, channelId, workspace }) {
  return `${userId}:${channelId}:${workspace}`;
}

/** Locks active work per user/workspace, independent of the Discord thread. */
export function taskKey({ userId, workspace }) {
  return `${userId}:${workspace}`;
}

export function conversationKey({ userId, channelId }) {
  return `${userId}:${channelId}`;
}

export class SessionStore {
  #file;
  #sessions = new Map();
  #activeWorkspaces = new Map();
  #activeModels = new Map();
  #activeReasoningEfforts = new Map();
  #progressLineCounts = new Map();
  #saveChain = Promise.resolve();
  #bindingRevisions = new Map();
  #bindingChains = new Map();
  #activeRuns = new Map();
  #runEpochs = new Map();

  constructor(stateDir) {
    this.#file = path.join(stateDir, "sessions.json");
  }

  async load() {
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    try {
      const raw = JSON.parse(await readFile(this.#file, "utf8"));
      if (raw && typeof raw === "object" && raw.bindingRevisions && typeof raw.bindingRevisions === 'object') {
        for (const [key, revision] of Object.entries(raw.bindingRevisions)) {
          if (Number.isSafeInteger(revision) && revision >= 0) this.#bindingRevisions.set(key, revision);
        }
      }
      if (raw && typeof raw === "object" && raw.sessions && typeof raw.sessions === "object") {
        for (const [key, value] of Object.entries(raw.sessions)) {
          if (validPendingBinding(value)) {
            this.#sessions.set(key, Object.freeze({ ...value }));
            this.#bindingRevisions.set(key, Math.max(this.#bindingRevisions.get(key) ?? 0, value.selectionRevision));
          } else if (value?.sessionId === null) {
            throw new Error('Pending history binding cannot be loaded safely');
          } else if (value?.origin === 'native-fork'
              && (!threadId(value.sourceThreadId) || !threadId(value.sourceLastCompletedTurnId)
                || value.sessionId === value.sourceThreadId
                || (value.forkGoalPrepared !== undefined && typeof value.forkGoalPrepared !== 'boolean'))) {
            throw new Error('Fork session binding cannot be loaded safely');
          } else if (typeof value?.sessionId === "string" && threadId(value.sessionId)
              && typeof value?.workspace === "string") {
            const checkpoint = sanitizeCheckpoint(value.checkpoint);
            const selectionRevision = Number.isSafeInteger(value.selectionRevision) && value.selectionRevision >= 0
              ? value.selectionRevision : 0;
            const session = { schemaVersion: 2, sessionId: value.sessionId, workspace: value.workspace,
              origin: value.origin === 'native-fork' ? 'native-fork' : 'discord', selectionRevision,
              ...(value.origin === 'native-fork' && threadId(value.sourceThreadId)
                && threadId(value.sourceLastCompletedTurnId) ? { sourceThreadId: value.sourceThreadId,
                  sourceLastCompletedTurnId: value.sourceLastCompletedTurnId,
                  ...(Number.isFinite(value.sourceUpdatedAt) ? { sourceUpdatedAt: value.sourceUpdatedAt } : {}),
                  forkGoalPrepared: value.forkGoalPrepared === true } : {}),
              ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
              ...(checkpoint ? { checkpoint } : {}) };
            this.#sessions.set(key, Object.freeze(session));
            this.#bindingRevisions.set(key, Math.max(this.#bindingRevisions.get(key) ?? 0, selectionRevision));
          }
        }
      }
      if (raw && typeof raw === "object" && raw.activeWorkspaces && typeof raw.activeWorkspaces === "object") {
        for (const [key, workspace] of Object.entries(raw.activeWorkspaces)) {
          if (typeof workspace === "string") this.#activeWorkspaces.set(key, workspace);
        }
      }
      if (raw && typeof raw === "object" && raw.activeModels && typeof raw.activeModels === "object") {
        for (const [key, model] of Object.entries(raw.activeModels)) {
          if (typeof model === "string") this.#activeModels.set(key, model);
        }
      }
      if (raw && typeof raw === "object" && raw.activeReasoningEfforts && typeof raw.activeReasoningEfforts === "object") {
        for (const [key, effort] of Object.entries(raw.activeReasoningEfforts)) {
          if (typeof effort === "string") this.#activeReasoningEfforts.set(key, effort);
        }
      }
      if (raw && typeof raw === "object" && raw.progressLineCounts && typeof raw.progressLineCounts === "object") {
        for (const [key, count] of Object.entries(raw.progressLineCounts)) {
          if (Number.isSafeInteger(count) && count >= 0 && count <= 8) this.#progressLineCounts.set(key, count);
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  get(key) {
    return this.#sessions.get(key) ?? null;
  }

  bindingRevision(key) {
    return this.#bindingRevisions.get(key) ?? 0;
  }

  runEpoch(workspaceRunKey) {
    return this.#runEpochs.get(workspaceRunKey) ?? 0;
  }

  async set(key, value) {
    return this.#serializeBinding(key, async () => {
      if (typeof value?.sessionId !== 'string' || !threadId(value.sessionId)
          || typeof value.workspace !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value.workspace)
          || (value.origin === 'native-fork' && (!threadId(value.sourceThreadId)
            || !threadId(value.sourceLastCompletedTurnId) || value.sessionId === value.sourceThreadId
            || (value.sourceUpdatedAt !== undefined && !Number.isFinite(value.sourceUpdatedAt))
            || (value.forkGoalPrepared !== undefined && typeof value.forkGoalPrepared !== 'boolean')))) {
        throw new TypeError('Session binding is invalid');
      }
      const existing = this.#sessions.get(key);
      const priorRevision = this.bindingRevision(key);
      const sameSession = existing?.sessionId === value.sessionId;
      const next = Object.freeze({ schemaVersion: 2, sessionId: value.sessionId, workspace: value.workspace,
        origin: value.origin === 'native-fork' ? 'native-fork'
          : sameSession && existing.origin === 'native-selection' ? 'native-selection' : 'discord',
        selectionRevision: sameSession ? priorRevision : priorRevision + 1,
        ...(value.origin === 'native-fork' && threadId(value.sourceThreadId)
          && threadId(value.sourceLastCompletedTurnId) ? { sourceThreadId: value.sourceThreadId,
            sourceLastCompletedTurnId: value.sourceLastCompletedTurnId,
            ...(Number.isFinite(value.sourceUpdatedAt) ? { sourceUpdatedAt: value.sourceUpdatedAt } : {}),
            forkGoalPrepared: typeof value.forkGoalPrepared === 'boolean' ? value.forkGoalPrepared
              : sameSession && existing?.origin === 'native-fork' ? existing.forkGoalPrepared === true : false } : {}),
        ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
        ...(sameSession && existing.checkpoint ? { checkpoint: existing.checkpoint } : {}) });
      const previous = existing;
      this.#sessions.set(key, next);
      this.#bindingRevisions.set(key, next.selectionRevision);
      try { await this.#save(); }
      catch (error) {
        if (previous) this.#sessions.set(key, previous); else this.#sessions.delete(key);
        this.#bindingRevisions.set(key, priorRevision);
        throw error;
      }
    });
  }

  async setPendingSelection(key, { workspace, source, sourceThreadId, sourceLastCompletedTurnId, sourceUpdatedAt = null,
    expectedRevision, expectedRunEpoch = null, workspaceRunKey = key } = {}) {
    return this.#serializeKeys([key, workspaceRunKey], async () => {
      if (this.#activeRuns.has(workspaceRunKey)) throw Object.assign(new Error('A Codex task is active for this binding'), { code: 'SESSION_BINDING_BUSY' });
      if (expectedRunEpoch !== null && expectedRunEpoch !== this.runEpoch(workspaceRunKey)) {
        throw Object.assign(new Error('A Codex task changed this workspace since the history list was loaded'), { code: 'SESSION_BINDING_CONFLICT' });
      }
      if (typeof workspace !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(workspace)
          || !THREAD_SOURCES.has(source) || !threadId(sourceThreadId) || !threadId(sourceLastCompletedTurnId)) {
        throw new TypeError('Pending history selection is invalid');
      }
      const priorRevision = this.bindingRevision(key);
      if (expectedRevision !== priorRevision) throw Object.assign(new Error('Session binding changed; reopen the history preview'), { code: 'SESSION_BINDING_CONFLICT' });
      const previous = this.#sessions.get(key);
      const next = Object.freeze({ schemaVersion: 2, sessionId: null, workspace,
        origin: 'native-selection', source, sourceThreadId, sourceLastCompletedTurnId,
        ...(Number.isFinite(sourceUpdatedAt) ? { sourceUpdatedAt } : {}),
        selectionMode: 'fork', selectionRevision: priorRevision + 1, updatedAt: new Date().toISOString() });
      this.#sessions.set(key, next);
      this.#bindingRevisions.set(key, next.selectionRevision);
      try { await this.#save(); }
      catch (error) {
        if (previous) this.#sessions.set(key, previous); else this.#sessions.delete(key);
        this.#bindingRevisions.set(key, priorRevision);
        throw error;
      }
      return next;
    });
  }

  async beginRun(key, workspaceRunKey = key, expectedRevision = null, expectedRunEpoch = null, { allowPendingFork = false } = {}) {
    return this.#serializeKeys([key, workspaceRunKey], async () => {
      if (expectedRevision !== null && expectedRevision !== this.bindingRevision(key)) {
        throw Object.assign(new Error('Session binding changed before the task could start'), { code: 'SESSION_BINDING_CONFLICT' });
      }
      if (expectedRunEpoch !== null && expectedRunEpoch !== this.runEpoch(workspaceRunKey)) {
        throw Object.assign(new Error('Workspace run state changed before the task could start'), { code: 'SESSION_BINDING_CONFLICT' });
      }
      const current = this.#sessions.get(key);
      if (current?.origin === 'native-selection' && current.sessionId === null && !allowPendingFork) {
        throw Object.assign(new Error('This conversation is pending a safe fork and cannot run until history resume is implemented'), { code: 'SESSION_SELECTION_PENDING' });
      }
      if (this.#activeRuns.has(workspaceRunKey)) throw Object.assign(new Error('A task is already active for this workspace'), { code: 'SESSION_BINDING_BUSY' });
      const lease = randomUUID();
      this.#activeRuns.set(workspaceRunKey, lease);
      this.#runEpochs.set(workspaceRunKey, this.runEpoch(workspaceRunKey) + 1);
      return lease;
    });
  }

  async endRun(key, lease, workspaceRunKey = key) {
    return this.#serializeKeys([key, workspaceRunKey], async () => {
      if (!lease || this.#activeRuns.get(workspaceRunKey) !== lease) return false;
      this.#activeRuns.delete(workspaceRunKey);
      this.#runEpochs.set(workspaceRunKey, this.runEpoch(workspaceRunKey) + 1);
      return true;
    });
  }

  checkpoint(key) {
    return this.#sessions.get(key)?.checkpoint ?? null;
  }

  async setCheckpoint(key, value) {
    return this.#serializeBinding(key, async () => {
      const session = this.#sessions.get(key);
      if (!session?.sessionId) return false;
      const checkpoint = sanitizeCheckpoint(value);
      if (!checkpoint) throw new Error("Checkpoint requires a bounded runtime id");
      if (session.checkpoint?.id === checkpoint.id
          && (session.checkpoint.state === "stopped" || checkpoint.state !== "stopped")) return false;
      this.#sessions.set(key, Object.freeze({ ...session, checkpoint }));
      await this.#save();
      return true;
    });
  }

  async clearCheckpoint(key, sessionId = null) {
    return this.#serializeBinding(key, async () => {
      const session = this.#sessions.get(key);
      if (!session?.checkpoint || (sessionId && session.sessionId !== sessionId)) return false;
      const { checkpoint: _checkpoint, ...current } = session;
      this.#sessions.set(key, Object.freeze(current));
      await this.#save();
      return true;
    });
  }

  async delete(key, workspaceRunKey = key) {
    return this.#serializeKeys([key, workspaceRunKey], async () => {
      if (this.#activeRuns.has(workspaceRunKey)) throw Object.assign(new Error('Cancel the active task before resetting this session'), { code: 'SESSION_BINDING_BUSY' });
      const previous = this.#sessions.get(key);
      const priorRevision = this.bindingRevision(key);
      this.#sessions.delete(key);
      this.#bindingRevisions.set(key, priorRevision + 1);
      try { await this.#save(); }
      catch (error) {
        if (previous) this.#sessions.set(key, previous);
        this.#bindingRevisions.set(key, priorRevision);
        throw error;
      }
      return Boolean(previous);
    });
  }

  activeWorkspace(key) {
    return this.#activeWorkspaces.get(key) ?? null;
  }

  async setActiveWorkspace(key, workspace) {
    this.#activeWorkspaces.set(key, workspace);
    await this.#save();
  }

  activeModel(key) {
    return this.#activeModels.get(key) ?? null;
  }

  async setActiveModel(key, model) {
    if (model === null) this.#activeModels.delete(key);
    else this.#activeModels.set(key, model);
    await this.#save();
  }

  activeReasoningEffort(key) {
    return this.#activeReasoningEfforts.get(key) ?? null;
  }

  async setActiveReasoningEffort(key, effort) {
    if (effort === null) this.#activeReasoningEfforts.delete(key);
    else this.#activeReasoningEfforts.set(key, effort);
    await this.#save();
  }

  progressLineCount(key) {
    return this.#progressLineCounts.get(key) ?? null;
  }

  async setProgressLineCount(key, count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 8) {
      throw new Error("Progress line count must be an integer from 0 to 8");
    }
    this.#progressLineCounts.set(key, count);
    await this.#save();
  }

  async #save() {
    const payload = JSON.stringify({
      schemaVersion: 2,
      sessions: Object.fromEntries(this.#sessions),
      bindingRevisions: Object.fromEntries(this.#bindingRevisions),
      activeWorkspaces: Object.fromEntries(this.#activeWorkspaces),
      activeModels: Object.fromEntries(this.#activeModels),
      activeReasoningEfforts: Object.fromEntries(this.#activeReasoningEfforts),
      progressLineCounts: Object.fromEntries(this.#progressLineCounts)
    }, null, 2) + "\n";
    const write = this.#saveChain.then(async () => {
      const temp = `${this.#file}.${process.pid}.tmp`;
      await writeFile(temp, payload, { mode: 0o600 });
      await chmod(temp, 0o600);
      await rename(temp, this.#file);
    });
    this.#saveChain = write.catch(() => {});
    return write;
  }

  async #serializeBinding(key, operation) {
    const previous = this.#bindingChains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.#bindingChains.set(key, current);
    try { return await current; }
    finally { if (this.#bindingChains.get(key) === current) this.#bindingChains.delete(key); }
  }

  async #serializeKeys(keys, operation) {
    const ordered = [...new Set(keys)].sort();
    const acquire = index => index >= ordered.length ? operation()
      : this.#serializeBinding(ordered[index], () => acquire(index + 1));
    return acquire(0);
  }
}
