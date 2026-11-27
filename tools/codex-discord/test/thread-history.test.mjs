import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createGoalClient, createThreadClient, spawnGoalClient } from '../../../intelligence/agent-runtime/thread-client.mjs';
import { listItems, listThreads, listTurns, readThreadMetadata } from '../../../intelligence/agent-runtime/thread-history.mjs';

function rpcHarness(options = {}) {
  const sent = [];
  const client = createThreadClient({ send: message => sent.push(message), ...options });
  async function reply(index, result, error = null) {
    const request = sent[index];
    client.receive({ id: request.id, ...(error ? { error } : { result }) });
  }
  return { client, sent, reply };
}

test('history RPC client allows only read methods and bounds per-response bytes', async () => {
  const h = rpcHarness();
  await assert.rejects(h.client.request('thread/resume', { threadId: 't1' }), { code: 'THREAD_METHOD_NOT_ALLOWED' });
  const pending = h.client.listThreads({ cwd: '/tmp/work' });
  await h.reply(0, { data: [] });
  assert.deepEqual(await pending, { data: [] });
  const large = rpcHarness({ maxResponseBytes: 32 });
  const oversized = large.client.listThreads({});
  large.client.receive(JSON.stringify({ id: large.sent[0].id, result: { data: ['x'.repeat(100)] } }));
  await assert.rejects(oversized, { code: 'THREAD_RESPONSE_TOO_LARGE' });
});

test('Goal RPC client allows only get, set and clear and history client remains read-only', async () => {
  const sent = [];
  const goals = createGoalClient({ send: message => sent.push(message) });
  const pending = goals.getGoal({ threadId: 'goal-thread' });
  assert.deepEqual(sent[0], { id: 1, method: 'thread/goal/get', params: { threadId: 'goal-thread' } });
  goals.receive({ id: sent[0].id, result: { goal: null } });
  assert.deepEqual(await pending, { goal: null });
  await assert.rejects(goals.request('thread/fork', { threadId: 'goal-thread' }), { code: 'THREAD_METHOD_NOT_ALLOWED' });
  await assert.rejects(goals.request('thread/resume', { threadId: 'goal-thread' }), { code: 'THREAD_METHOD_NOT_ALLOWED' });
  const history = createThreadClient({ send: () => {} });
  await assert.rejects(history.request('thread/goal/clear', { threadId: 'goal-thread' }), { code: 'THREAD_METHOD_NOT_ALLOWED' });
  await goals.close();
  await history.close();

  const timed = createGoalClient({ send: () => {}, timeoutMs: 10 });
  await assert.rejects(timed.getGoal({ threadId: 'goal-thread' }), { code: 'THREAD_RPC_TIMEOUT' });
  await timed.close();

  const oversized = createGoalClient({ send: message => sent.push(message), maxResponseBytes: 32 });
  const response = oversized.getGoal({ threadId: 'goal-thread' });
  oversized.receive(JSON.stringify({ id: sent.at(-1).id, result: { goal: { objective: 'x'.repeat(100) } } }));
  await assert.rejects(response, { code: 'THREAD_RESPONSE_TOO_LARGE' });
  await oversized.close();
});

test('spawned Goal client initializes App Server and exposes bounded native Goal RPCs', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stdin.write = value => {
    const request = JSON.parse(value);
    if (request.id === 1) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`));
    else if (request.method === 'thread/goal/get') queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: request.id, result: { goal: null } })}\n`));
    return true;
  };
  child.stdin.on('finish', () => queueMicrotask(() => child.emit('close', 0, null)));
  child.kill = () => { queueMicrotask(() => child.emit('close', 0, null)); return true; };
  const client = spawnGoalClient({ cwd: '/tmp/work', spawnImpl: () => child });
  await client.start();
  assert.deepEqual(await client.getGoal({ threadId: 'goal-thread' }), { goal: null });
  await client.close();
});

test('history RPC client reports malformed frames, RPC errors, timeout and closure safely', async () => {
  const malformed = rpcHarness();
  const badFrame = malformed.client.readThread({ threadId: 't1' });
  malformed.client.receive('{not-json');
  await assert.rejects(badFrame, { code: 'THREAD_MALFORMED_FRAME' });

  const errored = rpcHarness();
  const rpcError = errored.client.readThread({ threadId: 't1' });
  await errored.reply(0, null, { code: -32001, message: 'sensitive raw detail' });
  await assert.rejects(rpcError, error => error.code === 'THREAD_RPC_ERROR' && error.rpcCode === -32001
    && !error.message.includes('sensitive'));

  const timed = rpcHarness({ timeoutMs: 10 });
  await assert.rejects(timed.client.listThreads({}), { code: 'THREAD_RPC_TIMEOUT' });
  let transportClosed = false;
  const failedTransport = rpcHarness({ closeTransport: async () => { transportClosed = true; } });
  failedTransport.client.fail('THREAD_MALFORMED_FRAME');
  await failedTransport.client.close();
  assert.equal(transportClosed, true);
  await timed.client.close();
  await assert.rejects(timed.client.listThreads({}), { code: 'THREAD_CLIENT_CLOSED' });
});

test('thread list is exact-workspace scoped, bounded and excludes unsupported sources', async () => {
  const calls = [];
  const client = { async listThreads(params) {
    calls.push(params);
    return { data: [
      { id: 'thread-a', cwd: params.cwd, source: 'vscode', title: 'A', updatedAt: 20 },
      { id: 'thread-b', cwd: `${params.cwd}-sibling`, source: 'vscode', title: 'prefix trap' },
      { id: 'thread-c', cwd: params.cwd, source: 'subagent', title: 'excluded' }
    ], nextCursor: 'page-2' };
  } };
  const page = await listThreads(client, { workspaces: ['/tmp/project'], limit: 10 });
  assert.deepEqual(page.threads.map(thread => thread.id), ['thread-a']);
  assert.deepEqual(page.nextCursors, [{ cwd: '/tmp/project', cursor: 'page-2' }]);
  assert.equal(calls[0].useStateDbOnly, true);
  assert.equal(calls[0].includeTurns, undefined);
  assert.deepEqual(calls[0].sourceKinds, ['cli', 'vscode', 'appServer']);
  await assert.rejects(listThreads(client, { workspaces: ['/tmp/project'], limit: 11 }), RangeError);
  await assert.rejects(readThreadMetadata({ readThread: async () => ({ thread: { id: 't1', cwd: '/tmp/project', source: 'subagent' } }) },
    { threadId: 't1', cwd: '/tmp/project', sourceKinds: ['subagent'] }), TypeError);
  await assert.rejects(listThreads(client, { workspaces: ['/tmp/project'], cursors: [{ cwd: '/tmp/other', cursor: 'x' }] }), TypeError);
});

test('metadata read never requests turn bodies and verifies identity, exact cwd and provenance', async () => {
  const calls = [];
  const client = { async readThread(params) {
    calls.push(params);
    return { thread: { id: 't1', cwd: '/tmp/project', source: 'vscode', title: 'hello', turns: [{ secret: true }] } };
  } };
  const metadata = await readThreadMetadata(client, { threadId: 't1', cwd: '/tmp/project' });
  assert.equal(metadata.id, 't1');
  assert.equal('turns' in metadata, false);
  assert.deepEqual(calls, [{ threadId: 't1', includeTurns: false }]);
  await assert.rejects(readThreadMetadata(client, { threadId: 't1', cwd: '/tmp' }), { code: 'THREAD_SCOPE_MISMATCH' });
  const unknown = await readThreadMetadata({ async readThread() {
    return { thread: { id: 'unknown-thread', cwd: '/tmp/project', source: 'unknown', turns: [] } };
  } }, { threadId: 'unknown-thread', cwd: '/tmp/project', sourceKinds: ['unknown'] });
  assert.equal(unknown.source, 'unknown');
});

test('turn/item pages clamp sizes and return only user/assistant text', async () => {
  const seen = [];
  const client = {
    async listTurns(params) { seen.push(['turn', params]); return { data: [{ id: 'turn1', status: 'completed', usage: { secret: true } }], nextCursor: 'turn-cursor' }; },
    async listItems(params) { seen.push(['item', params]); return { data: [
      { turnId: 'turn1', item: { type: 'userMessage', content: [{ type: 'text', text: 'hello' }] } },
      { turnId: 'turn1', item: { type: 'agentMessage', text: 'world' } },
      { turnId: 'turn1', item: { type: 'reasoning', text: 'private reasoning' } },
      { turnId: 'turn1', item: { type: 'commandExecution', command: 'secret' } },
      { turnId: 'another-turn', item: { type: 'agentMessage', text: 'out of scope' } }
    ] }; }
  };
  const turns = await listTurns(client, { threadId: 't1', limit: 5 });
  assert.equal(turns.turns[0].usage, undefined);
  assert.equal(seen[0][1].limit, 5);
  assert.equal(seen[0][1].itemsView, 'summary');
  assert.equal(turns.nextCursor, 'turn-cursor');
  const items = await listItems(client, { threadId: 't1', turnId: 'turn1', limit: 20 });
  assert.deepEqual(items.messages, [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'world' }]);
  assert.equal(seen[1][1].limit, 20);
  await assert.rejects(listItems(client, { threadId: 't1', turnId: 'turn1', limit: 21 }), RangeError);
  await assert.rejects(listItems(client, { threadId: 't1', turnId: 'turn1', cursor: 'x'.repeat(513) }), TypeError);
});
