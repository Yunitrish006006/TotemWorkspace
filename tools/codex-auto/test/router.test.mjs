import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NativeModelRouter } from '../../../intelligence/agent-runtime/native-model-router.mjs';
import { loadKnowledge } from '../../../intelligence/workspace-knowledge.mjs';

const knowledge = loadKnowledge();
const models = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'].map(model => ({ model,
  inputModalities: model.includes('luna') ? ['text'] : ['text', 'image'],
  supportedReasoningEfforts: ['low', 'medium', 'high'], contextWindow: model.includes('luna') ? 10000 : 200000 }));
function makeRouter(extra = {}, turns = []) {
  const router = new NativeModelRouter({ knowledge, cwd: knowledge.root, catalog: async () => ({ models }), ...extra });
  router.observe({ result: { cwd: knowledge.root, thread: { id: 'same-thread', turns } } }, { method: 'thread/start' });
  return router;
}
const turn = (text, extra = {}) => ({ id: 9, method: 'turn/start', params: {
  threadId: 'same-thread', input: [{ type: 'text', text }], ...extra } });
const accepted = (router, request) => router.observe({ result: { turn: { id: 'turn-1' } } }, request);

test('same thread selects lightweight, balanced and strong models on different tasks', async () => {
  const router = makeRouter();
  for (const [text, expected] of [['查看 TotemWorkspace 進度', 'gpt-6-luna'],
    ['Fix the TotemWorkspace validator', 'gpt-6-sol'], ['Review runtime security contracts', 'gpt-6-astra']]) {
    const request = await router.route(turn(text));
    assert.equal(request.params.model, expected);
    assert.equal(request.params.threadId, 'same-thread');
    accepted(router, request);
  }
  const followup = await router.route(turn('繼續，把測試補齊'));
  assert.equal(followup.params.model, 'gpt-6-astra');
  assert.equal(followup.params.effort, 'high');
});

test('only model and effort change, including collaboration mode precedence', async () => {
  const router = makeRouter();
  const original = turn('Fix the TotemWorkspace validator', { model: 'native-default', effort: 'low',
    approvalPolicy: 'on-request', approvalsReviewer: 'user', permissions: 'managed-profile',
    sandboxPolicy: { type: 'readOnly' }, cwd: knowledge.root, additionalContext: { native: 'context' },
    collaborationMode: { mode: 'plan', settings: { model: 'native-plan-model', reasoning_effort: 'low', developer_instructions: null } } });
  const before = structuredClone(original);
  const result = await router.route(original);
  assert.deepEqual(original, before, 'Native request is not mutated');
  assert.deepEqual(result, { ...original, params: { ...original.params, model: 'gpt-6-sol', effort: 'medium',
    collaborationMode: { mode: 'plan', settings: { ...original.params.collaborationMode.settings,
      model: 'gpt-6-sol', reasoning_effort: 'medium' } } } });
});

test('failed start cannot replace the previous task or its risk floor', async () => {
  const router = makeRouter();
  const first = await router.route(turn('Review runtime security contracts')); accepted(router, first);
  const rejected = await router.route(turn('查看 TotemWorkspace 進度'));
  router.observe({ error: { message: 'Failed' } }, rejected);
  assert.equal((await router.route(turn('continue'))).params.model, 'gpt-6-astra');
});

test('explicit preferences cannot weaken a strong floor; unavailable strong tier blocks', async () => {
  assert.equal((await makeRouter({ model: 'gpt-6-luna' }).route(turn('Review security contracts'))).params.model, 'gpt-6-astra');
  const router = makeRouter({ catalog: async () => ({ models: models.filter(m => !m.model.includes('astra')) }) });
  await assert.rejects(router.route(turn('Review security contracts')), /No available model/);
});

test('images and observed context constrain later model selection', async () => {
  const router = makeRouter();
  const first = await router.route(turn('查看 TotemWorkspace 進度', { input: [
    { type: 'text', text: '查看 TotemWorkspace 進度' }, { type: 'localImage', path: '/tmp/image.png' }] }));
  assert.equal(first.params.model, 'gpt-6-sol'); accepted(router, first);
  assert.equal((await router.route(turn('查看 TotemWorkspace 進度'))).params.model, 'gpt-6-sol');
  const long = makeRouter();
  long.observe({ method: 'thread/tokenUsage/updated', params: { threadId: 'same-thread',
    tokenUsage: { last: { inputTokens: 12000, outputTokens: 1000 } } } });
  assert.equal((await long.route(turn('查看 TotemWorkspace 進度'))).params.model, 'gpt-6-sol');
});

test('resume recovers the previous task; unknown continuation stays conservative', async () => {
  const router = makeRouter({}, [{ items: [{ type: 'userMessage', content: [
    { type: 'text', text: 'Review runtime security contracts' }] }] }]);
  assert.equal((await router.route(turn('那開始做'))).params.model, 'gpt-6-astra');
  assert.equal((await makeRouter().route(turn('continue'))).params.model, 'gpt-6-astra');
  assert.equal((await makeRouter({ model: 'gpt-6-luna' }).route(turn('continue'))).params.model, 'gpt-6-astra');
  await assert.rejects(makeRouter({ catalog: async () => ({ models: models.filter(m => !m.model.includes('astra')) }) })
    .route(turn('continue')), /No available model/);
});

test('image-only user turns route through capability policy and preserve image history', async () => {
  const router = makeRouter();
  const first = await router.route(turn('', { input: [{ type: 'localImage', path: '/tmp/image.png' }] }));
  assert.equal(first.params.model, 'gpt-6-astra'); accepted(router, first);
  assert.equal((await router.route(turn('查看 TotemWorkspace 進度'))).params.model, 'gpt-6-sol');
  await assert.rejects(makeRouter({ catalog: async () => ({ models: models.filter(m => m.model.includes('luna')) }) })
    .route(turn('', { input: [{ type: 'image', url: 'https://example.org/image.png' }] })), /No available model/);
});

test('tool output, steering and interrupts are unchanged; invalid new turns fail closed', async () => {
  const router = makeRouter();
  for (const message of [{ method: 'turn/steer', params: { input: [{ type: 'text', text: 'continue' }] } },
    { method: 'turn/interrupt', params: { threadId: 'same-thread' } },
    { method: 'turn/start', params: { input: [], toolOutput: { name: 'test', output: 'passed' } } }]) {
    assert.equal(await router.route(message), message);
  }
  await assert.rejects(router.route(turn('x'.repeat(120001))), /120000/);
  await assert.rejects(router.route(turn('Fix this', { threadId: 'unknown' })), /Start or resume/);
});

test('clarification and contextual action retain the security floor, including reconstructed history', async () => {
  const router = makeRouter();
  accepted(router, await router.route(turn('Review TotemWorkspace runtime security contracts')));
  for (const text of ['use option B', 'fix it', '可以', 'continue']) {
    const routed = await router.route(turn(text));
    assert.equal(routed.params.model, 'gpt-6-astra'); accepted(router, routed);
  }
  const restored = makeRouter({}, ['Review TotemWorkspace runtime security contracts', 'use option B', 'fix it'].map(text => ({
    items: [{ type: 'userMessage', content: [{ type: 'text', text }] }] })));
  assert.equal((await restored.route(turn('continue'))).params.model, 'gpt-6-astra');
});

test('bounded routing rejects overflow instead of dropping newest instructions', async () => {
  const router = makeRouter();
  accepted(router, await router.route(turn('Review runtime security contracts ' + 'x'.repeat(119950))));
  await assert.rejects(router.route(turn('continue ' + 'y'.repeat(100))), /context exceeded/);
});
