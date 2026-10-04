import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalViewerServer } from '../../../scripts/serve-local-viewer.mjs';

test('authenticated Viewer display endpoint cannot dispatch/control work and rejects execution fields', async () => {
  let actions = 0;
  const server = createLocalViewerServer({ agentAdapter: {
    status: () => ({ available: true }), dispatch: () => { actions++; }, close() { actions++; }
  }, agentEnv: { TOTEM_CONVERSATION_SYNC_TOKEN: 'test-token' } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, token = 'test-token') => fetch(`${base}/api/conversation/mirror`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const entry = { runId: 'run', event: 'completed' };
  try {
    assert.equal((await post(entry, 'wrong')).status, 401);
    for (const body of [{ ...entry, model: 'any' }, { ...entry, cwd: '/' }, { ...entry, event: 'execute' }, { ...entry, text: 'x'.repeat(8193) }])
      assert.equal((await post(body)).status, 400);
    const accepted = await post(entry);
    assert.equal(accepted.status, 202);
    const result = await accepted.json();
    assert.equal(result.status, 'recorded');
    assert.doesNotMatch(result.entry.text, /\/home\/|secret=hidden/);
    assert.equal(result.entry.conversationId, 'discord-runtime:run');
    for (const route of ['prompt', 'cancel']) {
      const response = await fetch(`${base}/api/conversation/${route}`, { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
        body: JSON.stringify({ prompt: 'execute', taskId: 'any' }) });
      assert.equal(response.status, 410);
    }
    assert.equal(actions, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
