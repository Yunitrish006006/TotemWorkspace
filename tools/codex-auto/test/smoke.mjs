// Opt-in real Codex transport/inference smoke test; uses an ephemeral, read-only thread.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startModelProxy } from '../src/proxy.mjs';
import { loadKnowledge } from '../../../intelligence/workspace-knowledge.mjs';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-auto-smoke-'));
const decisions = [], settings = [], completions = new Map(), pending = new Map();
let sequence = 0;
const proxy = await startModelProxy({ cwd, knowledge: loadKnowledge(), onDecision: value => decisions.push(value) });
const socket = new WebSocket(`ws+unix://${proxy.socketPath}:/rpc`);
const send = message => socket.send(JSON.stringify(message));
socket.on('message', data => {
  const message = JSON.parse(data);
  if (!message.method) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'thread/settings/updated') settings.push(message.params);
  if (message.method === 'turn/completed') completions.set(message.params.turn.id, message.params.turn);
  if (message.method?.endsWith('/requestApproval')) send({ id: message.id, result: { decision: 'decline' } });
});
async function request(method, params) {
  const id = ++sequence;
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20000);
    pending.set(id, value => { clearTimeout(timer); resolve(value); }); send({ id, method, params });
  });
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
  return reply.result;
}
try {
  await once(socket, 'open');
  await request('initialize', { clientInfo: { name: 'totem_auto_smoke', title: 'Totem router smoke', version: '0.1.0' },
    capabilities: { experimentalApi: true } });
  send({ method: 'initialized' });
  const started = await request('thread/start', { cwd, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request',
    developerInstructions: 'This is a transport smoke test. Do not use tools or edit any files. Reply only READY.' });
  const threadId = started.thread.id;
  for (const prompt of ['Explain TotemWorkspace progress. Reply only READY; do not use tools.',
    'Fix the TotemWorkspace validator. Reply only READY; do not use tools or edit files.']) {
    const startedTurn = await request('turn/start', { threadId, input: [{ type: 'text', text: prompt }],
      sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'on-request' });
    const deadline = Date.now() + 120000;
    while (!completions.has(startedTurn.turn.id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    const turn = completions.get(startedTurn.turn.id);
    assert.equal(turn?.status, 'completed', `Native inference did not complete (${turn?.error?.message ?? 'timeout'})`);
    const decision = decisions.at(-1);
    const observed = settings.filter(value => value.threadId === threadId).at(-1)?.threadSettings;
    console.log(JSON.stringify({ threadId, status: turn.status, selectedModel: decision.model,
      selectedEffort: decision.effort, observedModel: observed?.model ?? null }));
  }
  assert.notEqual(decisions[0].model, decisions[1].model, 'Different task classes select different models');
  assert.equal(decisions[0].threadId, decisions[1].threadId);
} finally {
  await proxy.close();
  fs.rmSync(cwd, { recursive: true, force: true });
}
