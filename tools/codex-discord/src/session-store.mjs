import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const checkpointNumber = value => value != null && !(typeof value === "string" && !value.trim())
  && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : null;

function boundedId(value, limit = 200) {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]+$/.test(value) && value.length <= limit ? value : null;
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

  constructor(stateDir) {
    this.#file = path.join(stateDir, "sessions.json");
  }

  async load() {
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    try {
      const raw = JSON.parse(await readFile(this.#file, "utf8"));
      if (raw && typeof raw === "object" && raw.sessions && typeof raw.sessions === "object") {
        for (const [key, value] of Object.entries(raw.sessions)) {
          if (typeof value?.sessionId === "string" && typeof value?.workspace === "string") {
            const checkpoint = sanitizeCheckpoint(value.checkpoint);
            this.#sessions.set(key, { sessionId: value.sessionId, workspace: value.workspace,
              ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
              ...(checkpoint ? { checkpoint } : {}) });
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

  async set(key, value) {
    const existing = this.#sessions.get(key);
    const existingCheckpoint = existing?.sessionId === value.sessionId ? existing.checkpoint : null;
    this.#sessions.set(key, Object.freeze({
      sessionId: value.sessionId,
      workspace: value.workspace,
      ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
      ...(existingCheckpoint ? { checkpoint: existingCheckpoint } : {})
    }));
    await this.#save();
  }

  checkpoint(key) {
    return this.#sessions.get(key)?.checkpoint ?? null;
  }

  async setCheckpoint(key, value) {
    const session = this.#sessions.get(key);
    if (!session) return false;
    const checkpoint = sanitizeCheckpoint(value);
    if (!checkpoint) throw new Error("Checkpoint requires a bounded runtime id");
    if (session.checkpoint?.id === checkpoint.id
        && (session.checkpoint.state === "stopped" || checkpoint.state !== "stopped")) return false;
    this.#sessions.set(key, Object.freeze({ ...session, checkpoint }));
    await this.#save();
    return true;
  }

  async clearCheckpoint(key, sessionId = null) {
    const session = this.#sessions.get(key);
    if (!session?.checkpoint || (sessionId && session.sessionId !== sessionId)) return false;
    const { checkpoint: _checkpoint, ...current } = session;
    this.#sessions.set(key, Object.freeze(current));
    await this.#save();
    return true;
  }

  async delete(key) {
    const deleted = this.#sessions.delete(key);
    if (deleted) await this.#save();
    return deleted;
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
      sessions: Object.fromEntries(this.#sessions),
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
}
