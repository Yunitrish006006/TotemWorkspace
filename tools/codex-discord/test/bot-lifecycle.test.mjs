import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startBot } from '../src/bot.mjs';

for (const surface of ['message', 'slash']) test(`${surface}: delayed status delivery cannot replace an active task or its question controls`, async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const pendingStatuses = [], edits = [], cards = [];
  let running = false, execution, finish, starts = 0, answers = 0, checkpointClears = 0;
  let releaseCheckpoint;
  const runner = {
    isRunning: () => running,
    execute: args => {
      starts++; running = true; execution = args;
      return new Promise(resolve => { finish = () => {
        void args.onUsageCheckpoint({ method: 'bridge/usageGuard', workspace: '/tmp',
          params: { action: 'checkpoint', checkpointMutable: true, threadId: 'thread', turnId: 'turn' } });
        running = false; resolve({ exitCode: 0, message: 'Done', checkpointMutable: true });
      }; });
    },
    answerUserInput: () => { answers++; return true; },
    getUsage: async () => null
  };
  const sessions = {
    activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0,
    setActiveWorkspace: async () => {}, get: () => null,
    setCheckpoint: async () => new Promise(resolve => { releaseCheckpoint = resolve; }),
    clearCheckpoint: async () => { checkpointClears++; return true; }
  };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  } });
  const status = id => ({ id,
    edit: async payload => { edits.push([id, payload]); },
    reply: async payload => { cards.push(payload); return { edit: async () => {} }; },
    channel: { send: async () => {} }
  });
  const source = () => surface === 'message' ? {
    content: 'Inspect README', author: { id: 'owner', bot: false }, guildId: 'guild',
    channelId: 'channel', channel: {}, attachments: new Map(),
    reply: () => new Promise(resolve => pendingStatuses.push(resolve))
  } : {
    user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {}, commandName: 'codex',
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommand: () => 'run', getString: name => name === 'workspace' ? 'workspace' : 'Inspect README', getAttachment: () => null },
    deferred: false,
    deferReply: async function () { this.deferred = true; },
    editReply: () => new Promise(resolve => pendingStatuses.push(resolve))
  };
  const handler = client.listeners(surface === 'message' ? 'messageCreate' : 'interactionCreate')[0];
  const first = handler(source()), second = handler(source());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingStatuses.length, 2);
  pendingStatuses[0](status('first'));
  await new Promise(resolve => setImmediate(resolve));
  await execution.onUserInput({ kind: 'user-input', requestId: 'question', questions: [
    { id: 'choice', header: 'Choice', question: 'Choose', isOther: true, options: [] }
  ] });
  pendingStatuses[1](status('second'));
  await second;
  assert.equal(starts, 1);
  assert.ok(edits.some(([id, payload]) => id === 'second' && /already working/.test(payload.content)));
  const customId = cards[0].components[0].toJSON().components[0].custom_id.replace('codex:input:', 'codex:answers:');
  const replies = [];
  await client.listeners('interactionCreate')[0]({
    isButton: () => false, isModalSubmit: () => true, customId,
    user: { id: 'owner' }, channelId: 'channel', channel: {},
    fields: { getTextInputValue: () => 'Answer' }, reply: async payload => replies.push(payload)
  });
  assert.equal(answers, 1, 'the first task must retain ownership after the second request loses the race');
  assert.match(replies[0].content, /答案已送回/);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checkpointClears, 0, 'cleanup must wait for an in-flight checkpoint write');
  releaseCheckpoint(true);
  await first;
  assert.equal(checkpointClears, 1, 'a successful turn clears stale recovery evidence');
});

test('slash: first editReply clears deferred loading and exposes session recovery failures', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  let loading = false, executeCalls = 0;
  const edits = [], initialReplies = [];
  const runner = {
    isRunning: () => false,
    execute: async args => {
      executeCalls++;
      assert.equal(args.resumeSessionId, 'stale-session');
      assert.equal(args.resumeCheckpoint?.id, 'stale-session:turn-1');
      throw new Error('Cannot recover previous Codex session history');
    },
    cancel: () => false,
    getUsage: async () => null
  };
  const sessions = {
    activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0,
    setActiveWorkspace: async () => {}, get: () => ({ sessionId: 'stale-session',
      checkpoint: { id: 'stale-session:turn-1' } })
  };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  } });
  const interaction = {
    user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {}, commandName: 'codex',
    deferred: false, replied: false,
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommand: () => 'run', getString: name => name === 'workspace' ? 'workspace' : 'Continue task', getAttachment: () => null },
    deferReply: async function () { this.deferred = true; loading = true; },
    editReply: async payload => {
      loading = false;
      initialReplies.push(payload);
      return { id: 'status', edit: async update => {
        edits.push(update);
      } };
    },
    fetchReply: async () => ({ id: 'legacy-status', edit: async update => { edits.push(update); } }),
    reply: async payload => { initialReplies.push(payload); }
  };
  await client.listeners('interactionCreate')[0](interaction);

  assert.equal(loading, false, 'editReply replaces the deferred LOADING response');
  assert.match(initialReplies[0].content, /正在準備 Codex 任務/);
  assert.ok(edits.some(payload => /Cannot recover previous Codex session history/.test(payload.content)));
  assert.equal(executeCalls, 1, 'the failed recovery reaches the runner and surfaces its error');
});
