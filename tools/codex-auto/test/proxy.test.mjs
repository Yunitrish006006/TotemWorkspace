import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { startModelProxy } from '../src/proxy.mjs';
import { loadKnowledge } from '../../../intelligence/workspace-knowledge.mjs';

const knowledge = loadKnowledge();
const fixture = fileURLToPath(new URL('./fixtures/backend.mjs', import.meta.url));
const connect = proxy => new WebSocket(`ws+unix://${proxy.socketPath}:/rpc`);
async function harness() {
  let child;
  const proxy = await startModelProxy({ cwd: knowledge.root, knowledge,
    spawnImpl: (_bin, _args, options) => { child = spawn(process.execPath, [fixture], options); return child; } });
  const socket = connect(proxy);
  const messages = [], waiters = [];
  socket.on('message', data => {
    const value = JSON.parse(data);
    messages.push(value);
    for (const waiter of [...waiters]) if (waiter.match(value)) {
      waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(value);
    }
  });
  await once(socket, 'open');
  function wait(match) {
    const existing = messages.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture response timed out')), 3000);
      waiters.push({ match, resolve, timer });
    });
  }
  const send = value => socket.send(JSON.stringify(value));
  async function request(id, method, params = {}) { send({ id, method, params }); return wait(value => !value.method && value.id === id); }
  await request(0, 'initialize', {}); send({ method: 'initialized' });
  await request(1, 'thread/start', { cwd: knowledge.root });
  return { proxy, socket, send, request, wait, messages, get child() { return child; },
    async close() { for (const waiter of waiters) clearTimeout(waiter.timer); await proxy.close(); } };
}

test('real socket/stdio transport routes paginated catalog, preserves approvals and does not block interrupts', async () => {
  const h = await harness();
  try {
    assert.equal(fs.statSync(h.proxy.socketPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(fileURLToPath(new URL('.', `file://${h.proxy.socketPath}`))).mode & 0o777, 0o700);
    const params = { threadId: 'thread-1', input: [{ type: 'text', text: 'Fix TotemWorkspace validator' }],
      sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'on-request', approvalsReviewer: 'user', model: 'native-default' };
    h.send({ id: 'totem-router-3', method: 'turn/start', params });
    await h.request(77, 'turn/interrupt', { threadId: 'thread-1', turnId: 'old-turn' });
    assert.equal(h.messages.some(message => message.method === 'test/routed'), false);
    const response = await h.wait(value => !value.method && value.id === 'totem-router-3');
    assert.equal(response.result.turn.id, 'turn-1');
    const routed = await h.wait(value => value.method === 'test/routed');
    assert.deepEqual(routed.params, { ...params, model: 'gpt-6-sol', effort: 'medium' });
    const approval = await h.wait(value => value.method === 'item/commandExecution/requestApproval');
    h.send({ id: approval.id, result: { decision: 'decline' } });
    const acknowledged = await h.wait(value => value.method === 'test/approvalReply');
    assert.deepEqual(acknowledged.params, { id: approval.id, result: { decision: 'decline' } });
    const history = await h.request('read', 'test/read');
    assert.equal(history.result.seen.filter(value => value.method === 'model/list').length, 2);
    const next = await h.request(90, 'turn/start', { ...params, input: [{ type: 'text', text: '查看 TotemWorkspace 進度' }] });
    assert.ok(next.result);
    const later = await h.request('read2', 'test/read');
    assert.equal(later.result.seen.filter(value => value.method === 'model/list').length, 2, 'Catalog reused');
    assert.equal(later.result.seen.filter(value => value.method === 'turn/start').at(-1).params.model, 'gpt-6-luna');
    assert.equal(later.result.seen.filter(value => value.method === 'turn/start').at(-1).params.threadId, 'thread-1');
  } finally { await h.close(); }
  assert.equal(fs.existsSync(h.proxy.socketPath), false);
});

test('a browser Origin and an additional client are rejected', async () => {
  const proxy = await startModelProxy({ cwd: knowledge.root, knowledge });
  try {
    const browser = new WebSocket(`ws+unix://${proxy.socketPath}:/`, { origin: 'http://localhost' });
    await once(browser, 'error');
    // Rejected upgrades do not consume the one allowed native connection.
    const native = connect(proxy); await once(native, 'open');
    const additional = connect(proxy); await once(additional, 'error');
    native.terminate();
  } finally { await proxy.close(); }
});

test('malformed/binary RPC closes the connection; backend dies on client disconnect', async () => {
  const h = await harness();
  try {
    const exited = once(h.child, 'exit');
    h.socket.send(Buffer.from('{}'));
    await once(h.socket, 'close');
    await exited;
    assert.ok(h.child.signalCode || h.child.exitCode !== null);
  } finally { await h.close(); }
});

test('unknown thread returns an error without starting a turn', async () => {
  const h = await harness();
  try {
    const response = await h.request(5, 'turn/start', { threadId: 'unknown', input: [{ type: 'text', text: 'Fix this' }] });
    assert.equal(response.error.code, -32000);
    const history = await h.request(6, 'test/read');
    assert.equal(history.result.seen.some(value => value.method === 'turn/start'), false);
  } finally { await h.close(); }
});
