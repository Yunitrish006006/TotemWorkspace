import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireRuntimeWriteLease } from '../../../intelligence/agent-runtime/write-leases.mjs';

test('separate processes serialize workspace writes and release ownership without a model turn', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-cross-process-lock-'));
  const moduleUrl = new URL('../../../intelligence/agent-runtime/write-leases.mjs', import.meta.url).href;
  const code = `import { acquireRuntimeWriteLease } from ${JSON.stringify(moduleUrl)};
    try { const release = acquireRuntimeWriteLease(['/tmp/independent-consumer'], {lockDirectory: process.argv[1]}); release(); }
    catch (error) { process.exitCode = error.code === 'RUNTIME_WRITE_LOCKED' ? 9 : 8; }`;
  let release;
  try {
    release = acquireRuntimeWriteLease(['/tmp/core-contract'], { lockDirectory: directory });
    assert.equal(fs.statSync(path.join(directory, 'workspace.lock')).mode & 0o777, 0o600);
    const conflict = spawnSync(process.execPath, ['--input-type=module', '-e', code, directory], { encoding: 'utf8' });
    assert.equal(conflict.status, 9, 'the subprocess must identify the cross-process lock conflict');
    release();
    const accepted = spawnSync(process.execPath, ['--input-type=module', '-e', code, directory], { encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(fs.existsSync(path.join(directory, 'workspace.lock')), false);
  } finally { release?.(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('stale exited owners are safely reclaimed while malformed or live owners fail closed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-stale-lock-'));
  const file = path.join(directory, 'workspace.lock');
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: 2_147_000_000, token: 'stale' }), { mode: 0o600 });
    fs.writeFileSync(`${file}.recovery`, JSON.stringify({ pid: 2_147_000_000, token: 'stale-recovery' }), { mode: 0o600 });
    const release = acquireRuntimeWriteLease(['/tmp/stale-target'], { lockDirectory: directory });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, process.pid);
    assert.notEqual(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'stale');
    assert.equal(fs.existsSync(`${file}.recovery`), false);
    assert.deepEqual(fs.readdirSync(directory), ['workspace.lock']);
    release();
    fs.writeFileSync(file, 'malformed');
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/stale-target'], { lockDirectory: directory }), /unknown owner/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'malformed');
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token: 'live' }));
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/stale-target'], { lockDirectory: directory }), /held by PID/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'live');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('concurrent stale-lock recovery is serialized and never removes an active recovery owner', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-stale-recovery-'));
  const file = path.join(directory, 'workspace.lock');
  const recovery = `${file}.recovery`;
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: 2_147_000_000, token: 'stale' }), { mode: 0o600 });
    fs.writeFileSync(recovery, JSON.stringify({ pid: process.pid, token: 'recovery-owner' }), { mode: 0o600 });
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/stale-target'], { lockDirectory: directory }),
      error => error.code === 'RUNTIME_WRITE_LOCK_RECOVERY_BUSY');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'stale');
    assert.equal(JSON.parse(fs.readFileSync(recovery, 'utf8')).token, 'recovery-owner');
    fs.writeFileSync(recovery, 'malformed recovery');
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/stale-target'], { lockDirectory: directory }),
      error => error.code === 'RUNTIME_WRITE_LOCK_RECOVERY_BUSY');
    assert.equal(fs.readFileSync(recovery, 'utf8'), 'malformed recovery');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('release refuses to unlink a lock whose ownership token changed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lock-token-'));
  const file = path.join(directory, 'workspace.lock');
  try {
    const release = acquireRuntimeWriteLease(['/tmp/token-target'], { lockDirectory: directory });
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token: 'different-owner' }));
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/disjoint-token-target'], { lockDirectory: directory }), /ownership changed/);
    assert.throws(release, /ownership changed/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'different-owner');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
