import { constants } from 'node:fs';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DISCORD_ID = /^\d{17,20}$/;
const THREAD_ID = /^[a-zA-Z0-9_.:/-]{1,200}$/;
const SOURCE_KEY = /^[a-zA-Z0-9_.:-]{1,80}$/;
const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PROVENANCE = new Set(['discord-runtime', 'session-migration', 'native-source-owner', 'host-grant']);

function ownerKey(sourceKey, threadId) {
  return JSON.stringify([sourceKey, threadId]);
}

function validateRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.sourceKey !== 'string' || !SOURCE_KEY.test(value.sourceKey)
    || typeof value.threadId !== 'string' || !THREAD_ID.test(value.threadId)
    || typeof value.ownerUserId !== 'string' || !DISCORD_ID.test(value.ownerUserId)
    || !PROVENANCE.has(value.provenance)
    || typeof value.updatedAt !== 'string' || value.updatedAt.length > 40
    || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error('Thread ownership ledger is invalid');
  }
  return Object.freeze({ sourceKey: value.sourceKey, threadId: value.threadId,
    ownerUserId: value.ownerUserId, provenance: value.provenance, updatedAt: value.updatedAt });
}

function sessionOwner(entry) {
  if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') return null;
  const [key, value] = entry;
  const match = /^(\d{17,20}):(\d{17,20}):([a-z0-9][a-z0-9-]{0,31})$/.exec(key);
  if (!match || !value || typeof value !== 'object' || value.workspace !== match[3]
    || typeof value.sessionId !== 'string' || !THREAD_ID.test(value.sessionId)) return null;
  return { ownerUserId: match[1], threadId: value.sessionId };
}

async function readRegularJsonFile(file, mode = null) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) throw new Error('Invalid private JSON path');
    if (mode !== null) await handle.chmod(mode);
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

/** Persistent, append-only identity ledger for local Codex thread IDs. */
export class ThreadOwnershipStore {
  #file;
  #stateDir;
  #sourceKey;
  #records = new Map();
  #mutationChain = Promise.resolve();
  #loaded = false;

  constructor(stateDir, { sourceKey = 'codex-local' } = {}) {
    if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir)) throw new TypeError('stateDir must be absolute');
    if (typeof sourceKey !== 'string' || !SOURCE_KEY.test(sourceKey)) throw new TypeError('sourceKey is invalid');
    this.#stateDir = stateDir;
    this.#file = path.join(stateDir, 'thread-ownership.json');
    this.#sourceKey = sourceKey;
  }

  async load() {
    if (this.#loaded) return this;
    await mkdir(this.#stateDir, { recursive: true, mode: 0o700 });
    try {
      const raw = await readRegularJsonFile(this.#file, 0o600);
      if (raw?.schemaVersion !== 1 || !Array.isArray(raw.records)) throw new Error('Thread ownership ledger is invalid');
      for (const value of raw.records) {
        const record = validateRecord(value);
        const key = ownerKey(record.sourceKey, record.threadId);
        if (this.#records.has(key)) throw new Error('Thread ownership ledger contains duplicate identities');
        this.#records.set(key, record);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.#records.clear();
        throw new Error('Thread ownership ledger cannot be loaded safely');
      }
    }
    this.#loaded = true;
    try {
      const sessions = await readRegularJsonFile(path.join(this.#stateDir, 'sessions.json'));
      await this.migrateSessionMappings(sessions?.sessions ?? {});
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.#loaded = false;
        this.#records.clear();
        throw new Error('Legacy Discord thread ownership cannot be migrated safely');
      }
    }
    return this;
  }

  get({ sourceKey = this.#sourceKey, threadId } = {}) {
    this.#assertLoaded();
    this.#validateIdentity(sourceKey, threadId);
    return this.#records.get(ownerKey(sourceKey, threadId)) ?? null;
  }

  async claim({ sourceKey = this.#sourceKey, threadId, ownerUserId, provenance } = {}) {
    this.#assertLoaded();
    this.#validateIdentity(sourceKey, threadId);
    if (typeof ownerUserId !== 'string' || !DISCORD_ID.test(ownerUserId) || !PROVENANCE.has(provenance)) {
      throw new TypeError('Thread ownership record is invalid');
    }
    return this.#mutate(next => {
      const key = ownerKey(sourceKey, threadId);
      const current = next.get(key);
      if (current) {
        if (current.ownerUserId !== ownerUserId) throw Object.assign(new Error('Thread is unavailable'), { code: 'THREAD_OWNED' });
        return { changed: false, value: current };
      }
      const record = validateRecord({ sourceKey, threadId, ownerUserId, provenance, updatedAt: new Date().toISOString() });
      next.set(key, record);
      return { changed: true, value: record };
    });
  }

  async migrateSessionMappings(sessions) {
    this.#assertLoaded();
    if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) throw new TypeError('Legacy session mappings are invalid');
    const mappings = Object.entries(sessions).map(sessionOwner).filter(Boolean);
    return this.#mutate(next => {
      const planned = new Map();
      for (const mapping of mappings) {
        const key = ownerKey(this.#sourceKey, mapping.threadId);
        const existing = planned.get(key) ?? next.get(key);
        if (existing && existing.ownerUserId !== mapping.ownerUserId) {
          throw Object.assign(new Error('Conflicting legacy thread owners'), { code: 'THREAD_OWNER_CONFLICT' });
        }
        if (!existing) planned.set(key, validateRecord({ ...mapping, sourceKey: this.#sourceKey,
          provenance: 'session-migration', updatedAt: new Date().toISOString() }));
      }
      if (planned.size === 0) return { changed: false, value: 0 };
      for (const [key, record] of planned) next.set(key, record);
      return { changed: true, value: planned.size };
    });
  }

  #validateIdentity(sourceKey, threadId) {
    if (typeof sourceKey !== 'string' || !SOURCE_KEY.test(sourceKey)
      || typeof threadId !== 'string' || !THREAD_ID.test(threadId)) throw new TypeError('Thread identity is invalid');
  }

  #assertLoaded() {
    if (!this.#loaded) throw new Error('Thread ownership store must be loaded first');
  }

  #mutate(mutator) {
    const operation = this.#mutationChain.then(async () => {
      const next = new Map(this.#records);
      const result = mutator(next);
      if (result.changed) {
        const payload = JSON.stringify({ schemaVersion: 1, records: [...next.values()] }, null, 2) + '\n';
        const temp = `${this.#file}.${process.pid}.${randomUUID()}.tmp`;
        let renamed = false;
        try {
          const handle = await open(temp, 'wx', 0o600);
          try { await handle.writeFile(payload); await handle.sync(); }
          finally { await handle.close(); }
          await chmod(temp, 0o600);
          await rename(temp, this.#file);
          renamed = true;
        } finally {
          if (!renamed) await rm(temp, { force: true }).catch(() => {});
        }
        this.#records = next;
      }
      return result.value;
    });
    this.#mutationChain = operation.catch(() => {});
    return operation;
  }
}
