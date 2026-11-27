import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// One process-wide ownership ledger shared by all surface runner instances.
const active = new Map();
const processLocks = new Map();
const DEFAULT_LOCK_DIRECTORY = fileURLToPath(new URL('../../.totem-index/runtime-write-leases/', import.meta.url));

function workspaceLock(directory) {
  const lockDirectory = canonical(directory);
  const existing = processLocks.get(lockDirectory);
  if (existing) {
    let recorded;
    try { recorded = JSON.parse(fs.readFileSync(existing.file, 'utf8')); } catch { /* Missing or malformed locks fail closed. */ }
    if (recorded?.pid !== process.pid || recorded?.token !== existing.token) {
      throw new Error('Runtime write lock ownership changed; refusing another write lease');
    }
    existing.references++;
    return () => releaseWorkspaceLock(lockDirectory);
  }
  fs.mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(lockDirectory, 'workspace.lock');
  const token = randomUUID();
  let descriptor;
  for (let attempt = 0; attempt < 4 && descriptor === undefined; attempt++) {
    try {
      descriptor = fs.openSync(file, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* Unknown locks fail closed. */ }
      if (!ownerExited(owner?.pid)) throw workspaceLockConflict(owner);
      recoverExitedWorkspaceLock(file, owner);
    }
  }
  if (descriptor === undefined) {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* Contention remains fail closed. */ }
    throw workspaceLockConflict(owner);
  }
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
  } finally {
    fs.closeSync(descriptor);
  }
  processLocks.set(lockDirectory, { file, token, references: 1 });
  return () => releaseWorkspaceLock(lockDirectory);
}

function ownerExited(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

function workspaceLockConflict(owner) {
  const conflict = new Error(`Workspace write lock .totem-index/runtime-write-leases/workspace.lock is held by ${Number.isSafeInteger(owner?.pid) ? `PID ${owner.pid}` : 'an unknown owner'}. Stop conflicting work or retry after the owner exits.`);
  conflict.code = 'RUNTIME_WRITE_LOCKED';
  return conflict;
}

/** Serialize stale-owner cleanup and re-read the exact owner before unlinking. */
function recoverExitedWorkspaceLock(file, observedOwner) {
  const recoveryFile = `${file}.recovery`;
  const recoveryToken = randomUUID();
  let descriptor;
  for (let attempt = 0; attempt < 4 && descriptor === undefined; attempt++) {
    try {
      descriptor = fs.openSync(recoveryFile, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let recoveryOwner;
      try { recoveryOwner = JSON.parse(fs.readFileSync(recoveryFile, 'utf8')); } catch { /* Fail closed. */ }
      if (!ownerExited(recoveryOwner?.pid)) throw recoveryBusy(recoveryOwner);
      reclaimExitedRecoveryFile(recoveryFile, recoveryOwner);
    }
  }
  if (descriptor === undefined) {
    let recoveryOwner;
    try { recoveryOwner = JSON.parse(fs.readFileSync(recoveryFile, 'utf8')); } catch { /* Fail closed. */ }
    throw recoveryBusy(recoveryOwner);
  }
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token: recoveryToken,
      createdAt: new Date().toISOString() }));
    let currentOwner;
    try { currentOwner = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (currentOwner?.pid !== observedOwner?.pid || currentOwner?.token !== observedOwner?.token
        || !ownerExited(currentOwner.pid)) return;
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  } finally {
    fs.closeSync(descriptor);
    let currentRecovery;
    try { currentRecovery = JSON.parse(fs.readFileSync(recoveryFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (currentRecovery.pid !== process.pid || currentRecovery.token !== recoveryToken) {
      throw new Error('Workspace write-lock recovery ownership changed; refusing to remove another recovery lock');
    }
    fs.unlinkSync(recoveryFile);
  }
}

function recoveryBusy(owner) {
  const conflict = new Error(`Workspace write-lock recovery is already running${Number.isSafeInteger(owner?.pid) ? ` under PID ${owner.pid}` : ''}; retry shortly.`);
  conflict.code = 'RUNTIME_WRITE_LOCK_RECOVERY_BUSY';
  return conflict;
}

/** Atomically claim and recheck an exited recovery owner before removing its sidecar. */
function reclaimExitedRecoveryFile(file, observedOwner) {
  const quarantine = `${file}.stale-${randomUUID()}`;
  try { fs.renameSync(file, quarantine); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  let claimedOwner;
  try { claimedOwner = JSON.parse(fs.readFileSync(quarantine, 'utf8')); } catch { /* Restore malformed data and fail closed. */ }
  if (ownerExited(claimedOwner?.pid)) {
    fs.unlinkSync(quarantine);
    return;
  }
  let restored = false;
  try {
    fs.linkSync(quarantine, file);
    fs.unlinkSync(quarantine);
    restored = true;
  } catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'ENOENT') throw error;
  }
  if (!restored) {
    const conflict = recoveryBusy(claimedOwner ?? observedOwner);
    conflict.message += '; the claimed sidecar changed during recovery and was preserved';
    throw conflict;
  }
  throw recoveryBusy(claimedOwner ?? observedOwner);
}

function releaseWorkspaceLock(directory) {
  const lock = processLocks.get(directory);
  if (!lock || --lock.references > 0) return;
  processLocks.delete(directory);
  let recorded;
  try { recorded = JSON.parse(fs.readFileSync(lock.file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (recorded.token !== lock.token || recorded.pid !== process.pid) {
    throw new Error('Runtime write lock ownership changed; refusing to remove another owner\'s lock');
  }
  fs.unlinkSync(lock.file);
}
function canonical(root) {
  const absolute = path.resolve(root);
  try { return fs.realpathSync(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(absolute);
    return parent === absolute ? absolute : path.join(canonical(parent), path.basename(absolute));
  }
}
const contains = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

export function acquireRuntimeWriteLease(roots, { owner = 'runtime task', lockDirectory = DEFAULT_LOCK_DIRECTORY } = {}) {
  if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) {
    throw new Error('Runtime write lease requires absolute writable roots');
  }
  const normalized = [...new Set(roots.map(canonical))];
  for (const lease of active.values()) {
    if (normalized.some(root => lease.roots.some(existing => contains(root, existing) || contains(existing, root)))) {
      const error = new Error('Another runtime task owns an overlapping writable root');
      error.code = 'RUNTIME_WRITE_CONFLICT';
      throw error;
    }
  }
  const releaseProcessLock = normalized.length ? workspaceLock(lockDirectory) : () => {};
  const id = Symbol(owner);
  active.set(id, { roots: normalized, owner });
  return () => { if (active.delete(id)) releaseProcessLock(); };
}
