import test from 'node:test';
import assert from 'node:assert/strict';
import { historyChoiceLabel, historyListPayload, historyPreviewPayload, loadHistoryList, loadHistoryPreview, sanitizeHistoryText, validateHistoryForkSource } from '../src/history-ui.mjs';

const slash = String.fromCharCode(47);
const privatePath = `${slash}${['home', 'alice', 'repo'].join(slash)}`;
const privatePathPattern = new RegExp(`${slash}home${slash}alice`);

test('history display removes credentials, URLs, paths, mentions and controls while keeping line breaks', () => {
  const safe = sanitizeHistoryText(`Bearer abc.def\napi_key=secret https://private.example/x ${privatePath} @everyone <@12345678901234567>\u0007`);
  assert.match(safe, /憑證已隱藏/);
  assert.match(safe, /URL 已隱藏/);
  assert.match(safe, /本機路徑已隱藏/);
  assert.match(safe, /@\u200beveryone/);
  assert.match(safe, /mention 已隱藏/);
  assert.match(safe, /\n/);
  assert.doesNotMatch(safe, /abc\.def|private\.example|<@/);
  assert.doesNotMatch(safe, privatePathPattern);
});

test('history picker uses only opaque candidate values and safe option labels', () => {
  const title = `project ${privatePath}`;
  const label = historyChoiceLabel({ title, source: 'vscode', updatedAt: 1_800_000_000_000 });
  assert.doesNotMatch(label, privatePathPattern);
  const payload = historyListPayload({ workspaceName: 'workspace',
    threads: [{ title, source: 'vscode', updatedAt: 1_800_000_000_000, id: 'private-thread-id' }],
    candidateTokens: ['A'.repeat(32)] });
  const json = JSON.stringify(payload);
  assert.match(json, /A{32}/);
  assert.doesNotMatch(json, /private-thread-id/);
  assert.doesNotMatch(json, privatePathPattern);
  assert.equal(payload.components[0].toJSON().components[0].options[0].value, 'A'.repeat(32));
});

test('history picker marks Goal presence and status without exposing its objective', () => {
  const entries = [
    { title: 'Active Goal conversation', source: 'appServer', updatedAt: 1_800_000_000_000,
      goalStatus: 'active', objective: 'private objective' },
    { title: 'Ordinary conversation', source: 'cli', updatedAt: 1_800_000_000_000, goalStatus: null },
    { title: 'Unreadable Goal metadata', source: 'vscode', updatedAt: 1_800_000_000_000, goalStatus: 'unknown' },
    { title: 'Long Goal status label remains visible', source: 'appServer', updatedAt: 1_800_000_000_000,
      goalStatus: 'budgetLimited' }
  ];
  const payload = historyListPayload({ workspaceName: 'workspace', threads: entries,
    candidateTokens: ['A'.repeat(32), 'B'.repeat(32), 'C'.repeat(32), 'D'.repeat(32)] });
  assert.match(payload.content, /Goal：active/);
  assert.match(payload.content, /無 Goal/);
  assert.match(payload.content, /Goal：狀態未知/);
  assert.match(payload.content, /Goal：budgetLimited/);
  assert.doesNotMatch(payload.content, /private objective/);
  const options = payload.components[0].toJSON().components[0].options;
  assert.ok(options.every(option => option.label.length <= 100));
});

test('continue picker and preview expose continuation actions only for eligible Goal states', () => {
  const entries = [{ title: 'Active work', source: 'appServer', updatedAt: 1_800_000_000_000,
    goalStatus: 'active' }];
  const list = historyListPayload({ workspaceName: 'workspace', threads: entries,
    candidateTokens: ['A'.repeat(32)], flow: 'continue' });
  assert.match(list.content, /可延續對話/);
  assert.equal(list.components[0].toJSON().components[0].custom_id, 'codex:continue:select');
  const preview = historyPreviewPayload({ workspaceName: 'workspace', thread: entries[0], turns: [],
    messages: [], candidateToken: 'A'.repeat(32), continueMode: true, goalStatus: 'active' });
  const buttons = preview.components[0].toJSON().components;
  assert.ok(buttons.some(button => button.custom_id === `codex:continue:chat:${'A'.repeat(32)}`));
  assert.ok(buttons.some(button => button.custom_id === `codex:continue:goal:${'A'.repeat(32)}`));
  assert.match(preview.contents.join('\n'), /Bot 控制的來源 Goal/);
  const ordinary = historyPreviewPayload({ workspaceName: 'workspace', thread: entries[0], turns: [],
    messages: [], candidateToken: 'B'.repeat(32), continueMode: true, goalStatus: null });
  assert.ok(!ordinary.components[0].toJSON().components.some(button => button.custom_id.startsWith('codex:continue:goal:')));
});

test('history list authorizes before returning candidates and carries opaque cursor paging', async () => {
  const calls = [], candidates = [];
  const client = { listThreads: async params => {
    calls.push(params);
    return { data: [
      { id: 'visible', title: 'Visible', source: 'vscode', cwd: '/work', updatedAt: 1, archived: false },
      { id: 'hidden', title: 'Hidden', source: 'appServer', cwd: '/work', updatedAt: 2, archived: false }
    ], nextCursor: 'server-page-token' };
  } };
  const access = {
    authorizeContext: async () => ({ workspacePath: '/work' }),
    filterThreads: async (_context, threads) => threads.filter(thread => thread.id === 'visible'),
    issueCandidate: async (_context, thread, options) => { candidates.push({ thread, options }); return { token: 'C'.repeat(32) }; },
    issueCursor: async (_context, options) => { calls.push(options); return { token: 'P'.repeat(32) }; }
  };
  const result = await loadHistoryList({ client, access, context: { userId: '12345678901234567' },
    workspaceName: 'workspace', query: 'Vis', source: 'all' });
  assert.deepEqual(calls[0].sourceKinds, ['cli', 'vscode', 'appServer']);
  assert.deepEqual(result.threads.map(thread => thread.id), ['visible']);
  assert.deepEqual(result.candidateTokens, ['C'.repeat(32)]);
  assert.equal(result.nextToken, 'P'.repeat(32));
  assert.equal(candidates[0].options.query, 'Vis');
});

test('history preview revalidates the candidate and projects only completed user and assistant text', async () => {
  const client = {
    readThread: async ({ threadId }) => ({ thread: { id: threadId, title: 'Preview', cwd: '/work', source: 'cli' } }),
    listTurns: async () => ({ data: [
      { id: 'turn-done', status: 'completed' }, { id: 'turn-live', status: 'inProgress' }
    ], nextCursor: null }),
    listItems: async ({ turnId }) => ({ data: [
      { turnId, item: { type: 'userMessage', content: [{ type: 'text', text: 'hello https://secret.example' }] } },
      { turnId, item: { type: 'agentMessage', text: 'Bearer token.value' } },
      { turnId, item: { type: 'reasoning', text: 'private reasoning' } },
      { turnId, item: { type: 'commandExecution', command: 'private command' } }
    ], nextCursor: null })
  };
  let revalidated = false;
  const access = {
    resolveCandidate: async (_context, { token, query, readMetadata }) => {
      assert.equal(token, 'candidate'); assert.equal(query, 'filter');
      const metadata = await readMetadata({ threadId: 'thread-1', cwd: '/work', sourceKinds: ['cli'] });
      assert.equal(metadata.id, 'thread-1'); revalidated = true;
      return { threadId: 'thread-1', source: 'cli' };
    },
    authorizeContext: async () => ({ workspacePath: '/work' })
  };
  const preview = await loadHistoryPreview({ client, access, context: {}, workspaceName: 'workspace',
    token: 'candidate', query: 'filter' });
  assert.equal(revalidated, true);
  assert.deepEqual(preview.messages.map(message => message.role), ['user', 'assistant']);
  const payload = historyPreviewPayload({ workspaceName: 'workspace', thread: preview.metadata,
    turns: preview.turns, messages: preview.messages, more: preview.more });
  const content = payload.contents.join('\n');
  assert.match(content, /URL 已隱藏/);
  assert.match(content, /憑證已隱藏/);
  assert.doesNotMatch(content, /secret\.example|token\.value|private reasoning|private command/);
  assert.ok(payload.contents.every(chunk => chunk.length <= 1_800));
});

test('history preview follows bounded item and turn cursors without losing candidate revalidation', async () => {
  const calls = [];
  const client = {
    readThread: async ({ threadId }) => ({ thread: { id: threadId, title: 'Paged', cwd: '/work', source: 'cli' } }),
    listTurns: async ({ cursor }) => {
      calls.push({ type: 'turns', cursor });
      return cursor
        ? { data: [{ id: 'older-turn', status: 'completed', completedAt: 1 }], nextCursor: null }
        : { data: [{ id: 'new-turn', status: 'completed', completedAt: 2 }], nextCursor: 'older-turns' };
    },
    listItems: async ({ turnId, cursor }) => {
      calls.push({ type: 'items', turnId, cursor });
      return { data: [{ turnId, item: { type: 'agentMessage', text: `${turnId} page` } }],
        nextCursor: cursor ? null : 'older-items' };
    }
  };
  const access = {
    resolveCandidate: async (_context, { readMetadata }) => {
      await readMetadata({ threadId: 'thread-1', cwd: '/work', sourceKinds: ['cli'] });
      return { threadId: 'thread-1', source: 'cli' };
    }, authorizeContext: async () => ({ workspacePath: '/work' })
  };
  const initial = await loadHistoryPreview({ client, access, context: {}, workspaceName: 'workspace', token: 'candidate' });
  assert.equal(initial.turnId, 'new-turn');
  assert.equal(initial.nextItemCursor, 'older-items');
  assert.equal(initial.nextTurnCursor, 'older-turns');
  const olderItems = await loadHistoryPreview({ client, access, context: {}, workspaceName: 'workspace',
    token: 'candidate', turnId: 'new-turn', turnCursor: 'older-turns', itemCursor: 'older-items' });
  assert.equal(olderItems.messages[0].text, 'new-turn page');
  assert.equal(calls.findLast(call => call.type === 'items').cursor, 'older-items');
  const olderTurn = await loadHistoryPreview({ client, access, context: {}, workspaceName: 'workspace',
    token: 'candidate', turnCursor: 'older-turns' });
  assert.equal(olderTurn.turnId, 'older-turn');
  assert.equal(calls.findLast(call => call.type === 'turns').cursor, 'older-turns');
});

test('selection anchor search continues across incomplete recent turns to the latest completed turn', async () => {
  const turnRequests = [];
  const client = {
    readThread: async () => ({ thread: { id: 'thread-anchor', title: 'Anchor', cwd: '/work', source: 'cli' } }),
    listTurns: async ({ cursor }) => {
      turnRequests.push(cursor ?? null);
      return cursor
        ? { data: [{ id: 'last-complete', status: 'completed', completedAt: 1 }], nextCursor: null }
        : { data: Array.from({ length: 5 }, (_, index) => ({ id: `incomplete-${index}`, status: 'failed' })), nextCursor: 'older-page' };
    },
    listItems: async ({ turnId }) => ({ data: [{ turnId, item: { type: 'agentMessage', text: 'completed anchor' } }], nextCursor: null })
  };
  const access = { resolveCandidate: async (_context, { readMetadata }) => {
    await readMetadata({ threadId: 'thread-anchor', cwd: '/work', sourceKinds: ['cli'] });
    return { threadId: 'thread-anchor', source: 'cli' };
  }, authorizeContext: async () => ({ workspacePath: '/work' }) };
  const preview = await loadHistoryPreview({ client, access, context: {}, workspaceName: 'workspace', token: 'candidate' });
  assert.deepEqual(turnRequests, [null, 'older-page']);
  assert.equal(preview.turnId, 'last-complete');
  assert.equal(preview.nextTurnCursor, null);
});

test('fork handoff recheck rejects active sources and anchors made stale after preview', async () => {
  const access = { authorizeContext: async () => ({ workspacePath: '/work' }),
    assertThreadReadable: async () => ({}) };
  const base = { access, context: {}, workspaceName: 'workspace', sourceThreadId: 'source',
    source: 'cli', lastCompletedTurnId: 'anchor' };
  const activeClient = { readThread: async () => ({ thread: { id: 'source', cwd: '/work', source: 'cli', status: 'active' } }),
    listTurns: async () => { throw new Error('must not read turns for an active source'); } };
  await assert.rejects(validateHistoryForkSource({ ...base, client: activeClient }), { code: 'HISTORY_SOURCE_ACTIVE' });
  const changedClient = { readThread: async () => ({ thread: { id: 'source', cwd: '/work', source: 'cli', status: 'notLoaded' } }),
    listTurns: async () => ({ data: [
      { id: 'newer', status: 'completed', startedAt: 20, completedAt: 30 },
      { id: 'anchor', status: 'completed', startedAt: 10, completedAt: 15 }
    ], nextCursor: null }) };
  await assert.rejects(validateHistoryForkSource({ ...base, client: changedClient }), { code: 'HISTORY_SOURCE_STALE' });
  const updatedMetadataClient = { readThread: async () => ({ thread: { id: 'source', cwd: '/work',
    source: 'cli', status: 'notLoaded', updatedAt: 99 } }), listTurns: async () => ({ data: [], nextCursor: null }) };
  await assert.rejects(validateHistoryForkSource({ ...base, client: updatedMetadataClient,
    sourceUpdatedAt: 10 }), { code: 'HISTORY_SOURCE_STALE' });
});
