import { clearRunApprovals, retireRunApprovals, belongsToActiveRun } from '../src/bot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { userInputFromRequest, userInputResponse } from '../../../intelligence/agent-runtime/user-input.mjs';
import { answersFromModal, ownsUserInput, presentUserInput, userInputCard, userInputModal } from '../src/user-input.mjs';

const request = () => userInputFromRequest({ id: '001', method: 'item/tool/requestUserInput', params: {
  threadId: 'thread', turnId: 'turn', questions: [{ id: '__proto__', header: 'Path', question: 'Choose a path', isOther: true,
    options: [{ label: 'A', description: 'First path' }, { label: 'B', description: 'Second path' }] }] } });

test('modal requires an explicit submission and maps option numbers, free text and skipped answers', () => {
  const input = request();
  const modal = userInputModal('token', input).toJSON();
  assert.equal(modal.custom_id, 'codex:answers:token');
  assert.equal(modal.components[0].components[0].value, undefined);
  for (const [text, expected] of [['2', ['B']], ['custom', ['custom']], ['', []]]) {
    const result = userInputResponse(input, answersFromModal(input, { getTextInputValue: () => text }));
    assert.deepEqual(JSON.parse(JSON.stringify(result)).answers.__proto__.answers, expected);
  }
  input.questions[0].isOther = false;
  assert.throws(() => answersFromModal(input, { getTextInputValue: () => 'wrong' }), /有效選項/);
});

test('only the owner in the allow-listed channel can open or submit a question', () => {
  const input = { ...request(), userId: 'owner', channelId: 'channel' };
  assert.equal(ownsUserInput(input, { user: { id: 'owner' }, channelId: 'channel' }, true), true);
  for (const [user, channel, allowed] of [['other', 'channel', true], ['owner', 'other', true], ['owner', 'channel', false]])
    assert.equal(ownsUserInput(input, { user: { id: user }, channelId: channel }, allowed), false);
  assert.equal(ownsUserInput(null, {}, true), false);
});

test('sensitive and overlong questions fail explicitly before posting rather than being truncated', () => {
  const input = request();
  input.questions[0].isSecret = true;
  assert.throws(() => userInputCard(input), /native private/);
  input.questions[0].isSecret = false;
  input.questions[0].question = 'x'.repeat(1600);
  assert.throws(() => userInputCard(input), /capacity/);
});

test('overlapping questions get independent cards; resolving one only disables its own controls', async () => {
  const records = [], posts = [], edits = [];
  const present = () => presentUserInput({ input: request(), key: 'task', userId: 'owner', channelId: 'channel',
    register: record => { records.push(record); return String(records.length); }, forget: () => assert.fail(),
    status: { reply: async payload => { const id = posts.push(payload); return { edit: async edit => edits.push([id, edit]) }; } } });
  await present(); await present();
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].allowedMentions, { parse: [] });
  await records[0].progress.resolveApproval();
  assert.deepEqual(edits, [[1, { components: [] }]]);
});

test('failed question delivery removes its pending presentation token', async () => {
  const forgotten = [];
  await assert.rejects(presentUserInput({ input: request(), register: () => 'token', forget: token => forgotten.push(token),
    status: { reply: async () => { throw new Error('delivery failed'); } } }), /delivery failed/);
  assert.deepEqual(forgotten, ['token']);
});

test('resolution before Discord finishes delivery disables the delivered card', async () => {
  let record, deliver;
  const edits = [];
  const pending = presentUserInput({ input: request(), register: value => { record = value; return 'race'; }, forget() {},
    status: { reply: () => new Promise(resolve => { deliver = resolve; }) } });
  await record.progress.resolveApproval();
  deliver({ edit: async value => edits.push(value) });
  await pending;
  assert.deepEqual(edits, [{ components: [] }]);
});

test('finishing an older task cannot retire controls of a newer task with the same key', async () => {
  const edits = []; let finish;
  const approvals = new Map([
    ['old', { runId: 'old', key: 'shared', progress: { resolveApproval: () => new Promise(resolve => { finish = resolve; }) } }],
    ['new', { runId: 'new', key: 'shared', progress: { resolveApproval: () => edits.push('new') } }]
  ]);
  const cleanup = clearRunApprovals(approvals, 'old');
  assert.deepEqual([...approvals.keys()], ['new']);
  await Promise.resolve();
  approvals.set('later', { runId: 'new', key: 'shared', progress: { resolveApproval: () => edits.push('later') } });
  finish(); await cleanup;
  assert.deepEqual([...approvals.keys()], ['new', 'later']); assert.deepEqual(edits, []);
});

test('approval-all preserves questions and old controls cannot address a reused runtime key', () => {
  const approvals = new Map([['command', { runId: 'run', kind: 'command' }], ['question', { runId: 'run', kind: 'user-input' }]]);
  retireRunApprovals(approvals, 'run', pending => pending.kind !== 'user-input');
  assert.deepEqual([...approvals.keys()], ['question']);
  const activeTasks = new Map([['session', { key: 'shared', runId: 'new' }]]);
  assert.equal(belongsToActiveRun({ key: 'shared', runId: 'old' }, activeTasks), false);
  assert.equal(belongsToActiveRun({ key: 'shared', runId: 'new' }, activeTasks), true);
});
