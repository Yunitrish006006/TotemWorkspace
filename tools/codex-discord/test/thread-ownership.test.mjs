import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ThreadOwnershipStore } from '../src/thread-ownership.mjs';

const userA = '323456789012345678';
const userB = '333456789012345678';
const channelA = '423456789012345678';
const channelB = '433456789012345678';

async function temporaryState(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-history-owner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('ownership claims are persistent, private and cannot be reassigned', async t => {
  const stateDir = await temporaryState(t);
  const owners = await new ThreadOwnershipStore(stateDir).load();
  const first = await owners.claim({ threadId: 'thread-1', ownerUserId: userA, provenance: 'discord-runtime' });
  assert.equal(first.ownerUserId, userA);
  assert.equal(owners.get({ threadId: 'thread-1' }).ownerUserId, userA);
  await assert.rejects(owners.claim({ threadId: 'thread-1', ownerUserId: userB, provenance: 'host-grant' }), { code: 'THREAD_OWNED' });
  const file = path.join(stateDir, 'thread-ownership.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const raw = await readFile(file, 'utf8');
  assert.match(raw, /thread-1/);
  assert.doesNotMatch(raw, /prompt|objective|history body/i);

  const restarted = await new ThreadOwnershipStore(stateDir).load();
  assert.equal(restarted.get({ threadId: 'thread-1' }).ownerUserId, userA);
});

test('concurrent claims serialize and keep the first durable owner', async t => {
  const stateDir = await temporaryState(t);
  const owners = await new ThreadOwnershipStore(stateDir).load();
  const outcomes = await Promise.allSettled([
    owners.claim({ threadId: 'race-thread', ownerUserId: userA, provenance: 'discord-runtime' }),
    owners.claim({ threadId: 'race-thread', ownerUserId: userB, provenance: 'host-grant' })
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  assert.equal(owners.get({ threadId: 'race-thread' }).ownerUserId, userA);
});

test('legacy session mappings migrate only provable Discord owners and survive reset/reload', async t => {
  const stateDir = await temporaryState(t);
  const sessions = {
    [`${userA}:${channelA}:workspace`]: { sessionId: 'legacy-thread', workspace: 'workspace' },
    [`${userA}:${channelB}:nexus`]: { sessionId: 'legacy-thread-2', workspace: 'nexus' },
    'legacy:unknown:workspace': { sessionId: 'unknown-thread', workspace: 'workspace' },
    [`${userB}:${channelA}:workspace`]: { sessionId: 'wrong-alias-thread', workspace: 'other' }
  };
  await writeFile(path.join(stateDir, 'sessions.json'), JSON.stringify({ sessions }), { mode: 0o600 });
  const owners = await new ThreadOwnershipStore(stateDir).load();
  assert.equal(owners.get({ threadId: 'legacy-thread' }).ownerUserId, userA);
  assert.equal(owners.get({ threadId: 'legacy-thread' }).provenance, 'session-migration');
  assert.equal(owners.get({ threadId: 'legacy-thread-2' }).ownerUserId, userA);
  assert.equal(owners.get({ threadId: 'unknown-thread' }), null);
  assert.equal(owners.get({ threadId: 'wrong-alias-thread' }), null);

  await rm(path.join(stateDir, 'sessions.json'));
  const reloaded = await new ThreadOwnershipStore(stateDir).load();
  assert.equal(reloaded.get({ threadId: 'legacy-thread' }).ownerUserId, userA);
});

test('conflicting legacy mappings fail closed without partially writing owners', async t => {
  const stateDir = await temporaryState(t);
  const sessions = {
    [`${userA}:${channelA}:workspace`]: { sessionId: 'conflict-thread', workspace: 'workspace' },
    [`${userB}:${channelB}:workspace`]: { sessionId: 'conflict-thread', workspace: 'workspace' }
  };
  await writeFile(path.join(stateDir, 'sessions.json'), JSON.stringify({ sessions }), { mode: 0o600 });
  const owners = new ThreadOwnershipStore(stateDir);
  await assert.rejects(owners.load(), /cannot be migrated safely/);
  assert.throws(() => owners.get({ threadId: 'conflict-thread' }), /loaded first/);
  await assert.rejects(stat(path.join(stateDir, 'thread-ownership.json')), { code: 'ENOENT' });
});

test('a malformed ownership ledger is not silently replaced', async t => {
  const stateDir = await temporaryState(t);
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, 'thread-ownership.json'), '{broken', { mode: 0o600 });
  await assert.rejects(new ThreadOwnershipStore(stateDir).load(), /cannot be loaded safely/);
});

test('a symlinked ownership path is rejected without changing its target', async t => {
  const stateDir = await temporaryState(t);
  const outside = path.join(stateDir, 'outside.json');
  const ledger = path.join(stateDir, 'thread-ownership.json');
  await writeFile(outside, '{"schemaVersion":1,"records":[]}', { mode: 0o644 });
  await symlink(outside, ledger);
  await assert.rejects(new ThreadOwnershipStore(stateDir).load(), /cannot be loaded safely/);
  assert.equal((await stat(outside)).mode & 0o777, 0o644);
});
