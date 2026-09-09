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
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* Unknown locks fail closed. */ }
    let exited = false;
    if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); } catch (probe) { exited = probe.code === 'ESRCH'; }
    }
    const conflict = new Error(`Workspace write lock .totem-index/runtime-write-leases/workspace.lock is held by ${Number.isSafeInteger(owner?.pid) ? `PID ${owner.pid}` : 'an unknown owner'}${exited ? ' (owner exited)' : ''}. Stop conflicting work or, only after confirming the owner exited, remove this local-state lock manually.`);
    conflict.code = 'RUNTIME_WRITE_LOCKED';
    throw conflict;
  }
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
  } finally {
    fs.closeSync(descriptor);
  }
  processLocks.set(lockDirectory, { file, token, references: 1 });
  return () => releaseWorkspaceLock(lockDirectory);
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
