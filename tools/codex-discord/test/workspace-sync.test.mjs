import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSync, isWorkspaceSyncEnabled } from '../src/workspace-sync.mjs';

const config = { workspaceSync: { url: 'http://127.0.0.1:18765/', token: 'test-token', workspaceName: 'workspace' } };

test('Viewer mirroring has no execution API and only posts bounded display entries', async () => {
  const requests = [];
  const sync = createWorkspaceSync({ config, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response('{}', { status: 202 });
  } });
  for (const key of ['submitPrompt', 'cancel', 'status', 'handlesWorkspace', 'start']) assert.equal(sync[key], undefined);
  assert.equal(isWorkspaceSyncEnabled(config, 'workspace'), true);
  sync.record('core', { runId: 'ignored', event: 'started' });
  sync.record('workspace', { runId: 'run1', event: 'started' });
  sync.record('workspace', { runId: 'run1', event: 'completed' });
  await sync.drain();
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.match(request.url, /\/api\/conversation\/mirror$/);
    assert.equal(request.options.headers.authorization, 'Bearer test-token');
    assert.deepEqual(Object.keys(JSON.parse(request.options.body)), ['runId', 'event']);
  }
  sync.record('workspace', { runId: 'run1', event: 'command' });
  await sync.drain();
  assert.equal(requests.length, 2);
});

test('slow Viewer coalesces progress, preserves terminal order and does not block record callers', async () => {
  let unblock;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const values = [];
  const sync = createWorkspaceSync({ config, fetchImpl: async (_url, options) => {
    values.push(JSON.parse(options.body));
    if (values.length === 1) await blocked;
    return new Response('{}', { status: 202 });
  } });
  assert.equal(sync.record('workspace', { runId: 'slow', event: 'started' }), undefined);
  for (let i = 0; i < 100; i++) sync.record('workspace', { runId: 'slow', event: i === 99 ? 'files' : 'command' });
  sync.record('workspace', { runId: 'slow', event: 'completed' });
  unblock(); await sync.drain();
  assert.deepEqual(values.map(value => value.event), ['started', 'files', 'completed']);
});

test('Viewer failure is isolated and raw errors, commands, questions and answers are not mirrored', async () => {
  const messages = [];
  let fetches = 0;
  const sync = createWorkspaceSync({ config, log: text => messages.push(text), fetchImpl: async () => {
    fetches++; throw new Error('secret-token private-endpoint');
  } });
  sync.progress('workspace', 'failed', { method: 'item/commandExecution/outputDelta', params: { delta: 'PRIVATE OUTPUT' } });
  sync.progress('workspace', 'failed', { method: 'item/tool/requestUserInput', params: { questions: ['PRIVATE QUESTION'] } });
  assert.equal(fetches, 0);
  sync.record('workspace', { runId: 'failed', event: 'failed' });
  await sync.drain();
  assert.equal(fetches, 1);
  assert.doesNotMatch(messages.join(''), /secret-token|private-endpoint/);
});

test('status projection cannot carry arbitrary text, paths, credentials or prompts', async () => {
  const entries = [];
  const sync = createWorkspaceSync({ config, fetchImpl: async (_url, options) => {
    entries.push(JSON.parse(options.body)); return new Response('{}', { status: 202 });
  } });
  sync.record('workspace', { runId: 'private', event: 'started', text: ['-----BEGIN', 'PRIVATE KEY----- secret', '/home', 'user/file'].join(' ') });
  sync.progress('workspace', 'private', { method: 'item/started', params: { item: { type: 'commandExecution', command: 'secret' } } });
  await sync.drain();
  assert.deepEqual(entries, [{ runId: 'private', event: 'started' }, { runId: 'private', event: 'command' }]);
});
