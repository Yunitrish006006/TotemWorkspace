import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHistoryAccess } from '../src/history-access.mjs';
import { ThreadOwnershipStore } from '../src/thread-ownership.mjs';

const userA = '323456789012345678';
const userB = '333456789012345678';
const guildId = '223456789012345678';
const channelA = '423456789012345678';
const channelB = '433456789012345678';

async function fixture(t, { owner = userA, grants = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-history-access-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const otherWorkspace = path.join(root, 'workspace-private');
  await mkdir(workspace, { recursive: true });
  await mkdir(otherWorkspace, { recursive: true });
  const ownership = await new ThreadOwnershipStore(path.join(root, 'state')).load();
  const config = {
    historyEnabled: true,
    guildId,
    allowedUserIds: new Set([userA, userB]),
    allowedChannelIds: new Set([channelA, channelB]),
    workspaces: new Map([
      ['workspace', { path: workspace }],
      ['private', { path: otherWorkspace }]
    ]),
    historyOwnerUserId: owner,
    historyThreadGrants: grants
  };
  const access = createHistoryAccess({ config, ownership });
  const context = (userId = userA, channelId = channelA, workspaceName = 'workspace') => ({
    userId, guildId, channelId, parentId: null, workspaceName
  });
  const thread = (id, cwd = workspace, source = 'vscode') => ({ id, cwd, source });
  return { root, workspace, otherWorkspace, ownership, config, access, context, thread };
}

test('per-user ledger ownership overrides host owner and filters candidate lists without revealing denied IDs', async t => {
  const f = await fixture(t);
  await f.ownership.claim({ threadId: 'discord-b-thread', ownerUserId: userB, provenance: 'discord-runtime' });
  const native = f.thread('native-thread', f.workspace, 'vscode');
  const ownedByB = f.thread('discord-b-thread', f.workspace, 'appServer');
  const visibleToA = await f.access.filterThreads(f.context(userA), [native, ownedByB]);
  assert.deepEqual(visibleToA.map(value => value.id), ['native-thread']);
  const visibleToB = await f.access.filterThreads(f.context(userB), [native, ownedByB]);
  assert.deepEqual(visibleToB.map(value => value.id), ['discord-b-thread']);
  await assert.rejects(f.access.assertThreadReadable(f.context(userA), ownedByB), { code: 'HISTORY_UNAVAILABLE' });
});

test('owner unset denies native history, while host grants apply only to unowned appServer/unknown sources', async t => {
  const f = await fixture(t, { owner: null, grants: [{ threadId: 'granted-thread', userId: userB }] });
  await assert.rejects(f.access.assertThreadReadable(f.context(userA), f.thread('native', f.workspace, 'vscode')),
    { code: 'HISTORY_UNAVAILABLE' });
  await assert.rejects(f.access.assertThreadReadable(f.context(userB), f.thread('granted-thread', f.workspace, 'cli')),
    { code: 'HISTORY_UNAVAILABLE' });
  const granted = await f.access.assertThreadReadable(f.context(userB), f.thread('granted-thread', f.workspace, 'appServer'));
  assert.equal(granted.provenance, 'host-grant');
  assert.equal(f.ownership.get({ threadId: 'granted-thread' }).ownerUserId, userB);
  await assert.rejects(f.access.assertThreadReadable(f.context(userB), f.thread('not-granted', f.workspace, 'unknown')),
    { code: 'HISTORY_UNAVAILABLE' });
});

test('host grant cannot override a known other owner', async t => {
  const f = await fixture(t, { grants: [{ threadId: 'owned-thread', userId: userA }] });
  await f.ownership.claim({ threadId: 'owned-thread', ownerUserId: userB, provenance: 'session-migration' });
  await assert.rejects(f.access.assertThreadReadable(f.context(userA), f.thread('owned-thread', f.workspace, 'unknown')),
    { code: 'HISTORY_UNAVAILABLE' });
  assert.equal(f.ownership.get({ threadId: 'owned-thread' }).ownerUserId, userB);
});

test('exact canonical workspace checks reject prefix siblings and symlinks escaping the configured root', async t => {
  const f = await fixture(t);
  const link = path.join(f.root, 'outside-link');
  await symlink(f.otherWorkspace, link);
  await assert.rejects(f.access.assertThreadReadable(f.context(), f.thread('prefix', `${f.workspace}-private`, 'vscode')),
    { code: 'HISTORY_UNAVAILABLE' });
  await assert.rejects(f.access.assertThreadReadable(f.context(), f.thread('symlink-escape', link, 'vscode')),
    { code: 'HISTORY_UNAVAILABLE' });
  const inScopeAlias = path.join(f.root, 'workspace-alias');
  await symlink(f.workspace, inScopeAlias);
  assert.equal((await f.access.assertThreadReadable(f.context(), f.thread('same-canonical-root', inScopeAlias, 'vscode'))).threadId,
    'same-canonical-root');
});

test('history and channel allowlists are checked on every access', async t => {
  const f = await fixture(t);
  await f.access.authorizeContext(f.context());
  f.config.allowedUserIds.delete(userA);
  await assert.rejects(f.access.authorizeContext(f.context()), { code: 'HISTORY_UNAVAILABLE' });
  f.config.allowedUserIds.add(userA);
  await assert.rejects(f.access.authorizeContext({ ...f.context(), channelId: '999999999999999999' }), { code: 'HISTORY_UNAVAILABLE' });
  f.config.historyEnabled = false;
  await assert.rejects(f.access.authorizeContext(f.context()), { code: 'HISTORY_UNAVAILABLE' });
});

test('opaque cursor tokens are single-use and bound to user, channel, workspace, query and source', async t => {
  const f = await fixture(t);
  const issue = (context = f.context()) => f.access.issueCursor(context, {
    query: 'recent', source: 'vscode', cursors: [{ cwd: f.workspace, cursor: 'opaque-server-cursor' }]
  });
  const first = await issue();
  assert.match(first.token, /^[A-Za-z0-9_-]{32}$/);
  const state = await f.access.resolveCursor(f.context(), { token: first.token, query: 'recent', source: 'vscode' });
  assert.deepEqual(state.cursors, [{ cwd: f.workspace, cursor: 'opaque-server-cursor' }]);
  await assert.rejects(f.access.resolveCursor(f.context(), { token: first.token, query: 'recent', source: 'vscode' }),
    { code: 'HISTORY_CURSOR_EXPIRED' });

  const cases = [
    [f.context(userB), { query: 'recent', source: 'vscode' }],
    [f.context(userA, channelB), { query: 'recent', source: 'vscode' }],
    [f.context(userA, channelA, 'private'), { query: 'recent', source: 'vscode' }],
    [f.context(), { query: 'changed', source: 'vscode' }],
    [f.context(), { query: 'recent', source: 'appServer' }]
  ];
  for (const [context, args] of cases) {
    const cursor = await issue();
    await assert.rejects(f.access.resolveCursor(context, { token: cursor.token, ...args }), { code: 'HISTORY_CURSOR_EXPIRED' });
  }
  await assert.rejects(f.access.issueCursor(f.context(), {
    query: 'recent', source: 'vscode', cursors: [{ cwd: f.otherWorkspace, cursor: 'outside' }]
  }), /cursor state is invalid/);
});

test('candidate tokens hide thread IDs and re-read metadata and ownership on every use', async t => {
  const f = await fixture(t);
  const metadata = { ...f.thread('secret-thread-id', f.workspace, 'vscode'), updatedAt: 1234 };
  const candidate = await f.access.issueCandidate(f.context(), metadata, { query: 'recent' });
  assert.match(candidate.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(candidate.token.includes(metadata.id), false);
  const reads = [];
  const readMetadata = async input => { reads.push(input); return metadata; };
  const resolved = await f.access.resolveCandidate(f.context(), { token: candidate.token, query: 'recent', readMetadata });
  assert.equal(resolved.threadId, metadata.id);
  assert.equal(reads[0].threadId, metadata.id);
  assert.equal(reads[0].cwd, f.workspace);
  assert.deepEqual(reads[0].sourceKinds, ['vscode']);
  // The same short-lived candidate can support preview and later selection, with fresh authorization each time.
  await f.access.resolveCandidate(f.context(), { token: candidate.token, query: 'recent', readMetadata });
  await assert.rejects(f.access.resolveCandidate(f.context(userB), { token: candidate.token, query: 'recent', readMetadata }),
    { code: 'HISTORY_CANDIDATE_EXPIRED' });
});

test('candidate tokens expire, bind query/workspace and are invalidated by source updates or allowlist revocation', async t => {
  const f = await fixture(t);
  let time = 50_000;
  let tokenCounter = 70;
  const access = createHistoryAccess({ config: f.config, ownership: f.ownership, now: () => time,
    randomBytesImpl: size => Buffer.alloc(size, tokenCounter++) });
  const metadata = { ...f.thread('candidate-thread', f.workspace, 'vscode'), updatedAt: 7 };
  const issue = () => access.issueCandidate(f.context(), metadata, { query: 'q' });
  const readMetadata = async ({ threadId, cwd, sourceKinds }) => ({ ...metadata, id: threadId, cwd, source: sourceKinds[0] });

  let candidate = await issue();
  await assert.rejects(access.resolveCandidate(f.context(), { token: candidate.token, query: 'changed', readMetadata }),
    { code: 'HISTORY_CANDIDATE_EXPIRED' });
  candidate = await issue();
  await assert.rejects(access.resolveCandidate(f.context(userA, channelA, 'private'), { token: candidate.token, query: 'q', readMetadata }),
    { code: 'HISTORY_CANDIDATE_EXPIRED' });
  candidate = await issue();
  await assert.rejects(access.resolveCandidate(f.context(), { token: candidate.token, query: 'q',
    readMetadata: async args => ({ ...await readMetadata(args), updatedAt: 8 }) }), { code: 'HISTORY_UNAVAILABLE' });
  candidate = await issue();
  f.config.allowedUserIds.delete(userA);
  await assert.rejects(access.resolveCandidate(f.context(), { token: candidate.token, query: 'q', readMetadata }),
    { code: 'HISTORY_UNAVAILABLE' });
  f.config.allowedUserIds.add(userA);
  await assert.rejects(access.resolveCandidate(f.context(), { token: candidate.token, query: 'q', readMetadata }),
    { code: 'HISTORY_CANDIDATE_EXPIRED' });
  candidate = await issue();
  time += 5 * 60_000;
  await assert.rejects(access.resolveCandidate(f.context(), { token: candidate.token, query: 'q', readMetadata }),
    { code: 'HISTORY_CANDIDATE_EXPIRED' });
});

test('cursor tokens expire after five minutes, allowlist revocation invalidates them, and per-user capacity is bounded', async t => {
  const f = await fixture(t);
  let time = 10_000;
  let tokenCounter = 1;
  const access = createHistoryAccess({ config: f.config, ownership: f.ownership, now: () => time,
    randomBytesImpl: size => Buffer.alloc(size, tokenCounter++) });
  const args = { query: '', source: 'cli', cursors: [{ cwd: f.workspace, cursor: 'cursor' }] };
  const one = await access.issueCursor(f.context(), args);
  const two = await access.issueCursor(f.context(), args);
  await assert.rejects(access.issueCursor(f.context(), args), { code: 'HISTORY_CAPACITY' });
  await access.resolveCursor(f.context(), { token: one.token, query: '', source: 'cli' });
  const three = await access.issueCursor(f.context(), args);
  f.config.allowedUserIds.delete(userA);
  await assert.rejects(access.resolveCursor(f.context(), { token: two.token, query: '', source: 'cli' }), { code: 'HISTORY_UNAVAILABLE' });
  f.config.allowedUserIds.add(userA);
  await assert.rejects(access.resolveCursor(f.context(), { token: three.token, query: '', source: 'cli' }), { code: 'HISTORY_CURSOR_EXPIRED' });

  const expiring = await access.issueCursor(f.context(), args);
  time += 5 * 60_000;
  await assert.rejects(access.resolveCursor(f.context(), { token: expiring.token, query: '', source: 'cli' }), { code: 'HISTORY_CURSOR_EXPIRED' });
});
