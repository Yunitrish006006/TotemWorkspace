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
    catch (error) { process.stderr.write(error.code + ': ' + error.message); process.exitCode = 9; }`;
  let release;
  try {
    release = acquireRuntimeWriteLease(['/tmp/core-contract'], { lockDirectory: directory });
    assert.equal(fs.statSync(path.join(directory, 'workspace.lock')).mode & 0o777, 0o600);
    const conflict = spawnSync(process.execPath, ['--input-type=module', '-e', code, directory], { encoding: 'utf8' });
    assert.equal(conflict.status, 9);
    assert.match(conflict.stderr, /RUNTIME_WRITE_LOCKED/);
    release();
    const accepted = spawnSync(process.execPath, ['--input-type=module', '-e', code, directory], { encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(fs.existsSync(path.join(directory, 'workspace.lock')), false);
  } finally { release?.(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('stale or malformed lock owners fail closed and are never automatically deleted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-stale-lock-'));
  const file = path.join(directory, 'workspace.lock');
  try {
    fs.writeFileSync(file, '{"pid":2147483647,"token":"stale"}', { mode: 0o600 });
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/stale-target'], { lockDirectory: directory }), /only after confirming the owner exited/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'stale');
    fs.writeFileSync(file, 'malformed');
    assert.throws(() => acquireRuntimeWriteLease(['/tmp/stale-target'], { lockDirectory: directory }), /unknown owner/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'malformed');
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
