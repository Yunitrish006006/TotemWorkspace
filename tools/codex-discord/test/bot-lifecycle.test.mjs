import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startBot } from '../src/bot.mjs';
import { sessionKey } from '../src/session-store.mjs';

const slash = String.fromCharCode(47);
const privatePath = `${slash}${['home', 'person', 'work'].join(slash)}`;
const privatePathPattern = new RegExp(`${slash}home${slash}person`);

test('a new slash session is routed to its own Discord thread', async () => {
  const client = new EventEmitter(); client.login = async () => {};
  const sends = [], saved = [];
  const thread = { id: 'session-thread', toString: () => '<#session-thread>', send: async payload => {
    sends.push(payload); return { id: 'status-card', channelId: 'session-thread', edit: async () => {} };
  } };
  const channel = { id: 'channel', isThread: () => false, send: async () => ({
    startThread: async options => { assert.equal(options.name, '[workspace] Inspect README'); return thread; }
  }) };
  const sessions = { activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0,
    setActiveWorkspace: async () => {}, get: () => null, set: async (key, value) => saved.push([key, value]) };
  let executed = false;
  const runner = { isRunning: () => false, execute: async args => {
    executed = true;
    await args.onSessionId('codex-session');
    return { exitCode: 0, message: 'Done' };
  }, getUsage: async () => null };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  } });
  const replies = [];
  const interaction = { commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel,
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommand: () => 'run', getString: name => name === 'task' ? 'Inspect README' : null, getAttachment: () => null },
    deferReply: async payload => replies.push(['defer', payload]), editReply: async payload => replies.push(['edit', payload]),
    reply: async payload => replies.push(['reply', payload]) };
  await client.listeners('interactionCreate')[0](interaction);
  assert.ok(executed, JSON.stringify(replies));
  assert.ok(saved.some(([key]) => key === 'owner:session-thread:workspace'));
  assert.ok(replies.some(([, payload]) => /session thread/.test(payload.content)));
  assert.equal(sends.length, 1);
});

test('slash run inside an existing thread uses the parent workspace and does not open a sibling', async () => {
  const client = new EventEmitter(); client.login = async () => {};
  const threadMessages = [], replies = [], selections = new Map();
  let parentStarts = 0, execution = null, renamedThread = null;
  const sessions = {
    activeWorkspace: key => selections.get(key) ?? (key === 'owner:parent' ? 'totem-core' : null),
    setActiveWorkspace: async (key, workspace) => selections.set(key, workspace),
    activeModel: () => null, activeReasoningEffort: () => null, progressLineCount: () => 0, get: () => null,
    set: async () => {}
  };
  const runner = { isRunning: () => false, getUsage: async () => null,
    execute: async args => { execution = args; await args.onSessionId('new-codex-session');
      return { exitCode: 0, message: 'Done' }; } };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['parent']),
    workspaces: new Map([['workspace', { path: '/repo', allowNonGit: true }],
      ['totem-core', { path: '/repo/TotemCore', allowNonGit: false }]])
  } });
  const channel = {
    id: 'existing-thread', parentId: 'parent', parent: { id: 'parent', send: async () => {
      parentStarts++;
      throw new Error('must not create a sibling thread');
    } }, isThread: () => true, name: 'Existing discussion',
    setName: async name => { renamedThread = name; },
    send: async payload => { threadMessages.push(payload); return { id: 'status', edit: async next => threadMessages.push(next) }; }
  };
  const interaction = { commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'existing-thread', channel,
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => null, getSubcommand: () => 'run',
      getString: name => name === 'task' ? 'Continue here' : null, getAttachment: () => null },
    deferReply: async payload => replies.push(payload), editReply: async payload => replies.push(payload),
    reply: async payload => replies.push(payload) };
  await client.listeners('interactionCreate')[0](interaction);

  assert.equal(execution.workspace, '/repo/TotemCore');
  assert.equal(execution.resumeSessionId, null, 'an unbound existing thread starts its first Codex session in place');
  assert.equal(parentStarts, 0);
  assert.equal(renamedThread, '[totem-core] Existing discussion');
  assert.ok(threadMessages.some(payload => /totem-core/.test(payload.content ?? '')));
});

test('Goal commands are disabled by default and never fall through to the legacy run handler', async () => {
  let executes = 0;
  const runner = { execute: async () => { executes++; }, getUsage: async () => null };
  const sessions = { activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0 };
  const config = { botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]]) };
  const makeClient = async () => {
    const client = new EventEmitter();
    client.login = async () => {};
    await startBot({ clientFactory: () => client, runner, sessions, config });
    return client;
  };
  const makeInteraction = (action, replies) => ({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false,
    isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => 'goal', getSubcommand: () => action },
    reply: async payload => replies.push(payload)
  });

  const disabledClient = await makeClient();
  const actions = ['start', 'status', 'pause', 'resume', 'budget', 'clear'];
  const disabledReplies = [];
  for (const action of actions) await disabledClient.listeners('interactionCreate')[0](makeInteraction(action, disabledReplies));
  assert.equal(disabledReplies.length, actions.length);
  assert.ok(disabledReplies.every(reply => reply.ephemeral === true && /已停用/.test(reply.content)));
  assert.equal(executes, 0);

  const enabledClient = new EventEmitter();
  enabledClient.login = async () => {};
  await startBot({ clientFactory: () => enabledClient, runner, sessions, config: { ...config, goalsEnabled: true } });
  const enabledReplies = [];
  for (const action of actions) await enabledClient.listeners('interactionCreate')[0](makeInteraction(action, enabledReplies));
  assert.equal(enabledReplies.length, actions.length);
  assert.ok(enabledReplies.every(reply => reply.ephemeral === true && /尚未完成接線/.test(reply.content)));
  assert.equal(executes, 0, 'no M8.a Goal action falls through to the legacy runner');
});

test('Goal status is read-only and pending history selections cannot mutate the source Goal', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const replies = [], reads = [], mutations = [];
  const bindings = new Map([
    ['owner:channel:workspace', { sessionId: 'thread-exec' }],
    ['owner:channel:pending', { origin: 'native-selection', sessionId: null, sourceThreadId: 'thread-source' }]
  ]);
  const sessions = { get: key => bindings.get(key), activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0 };
  const runner = { isRunning: () => false, pauseGoal: () => false, execute: async () => { throw new Error('unexpected run'); } };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']), goalsEnabled: true,
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }], ['pending', { path: '/tmp', allowNonGit: true }]])
  }, goalClientFactory: async () => ({
    getGoal: async ({ threadId }) => { reads.push(threadId); return { goal: {
      threadId, objective: 'private objective', status: 'paused', tokenBudget: 500, tokensUsed: 20
    } }; },
    setGoal: async params => mutations.push(['set', params]), clearGoal: async params => mutations.push(['clear', params]),
    close: async () => {}
  }) });
  const invoke = async (action, workspaceName) => {
    const interaction = {
      commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
      isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
      options: { getSubcommandGroup: () => 'goal', getSubcommand: () => action,
        getString: name => name === 'workspace' ? workspaceName : null },
      deferReply: async payload => replies.push({ defer: payload }),
      editReply: async payload => replies.push(payload), reply: async payload => replies.push(payload)
    };
    await client.listeners('interactionCreate')[0](interaction);
  };
  await invoke('status', 'workspace');
  await invoke('status', 'pending');
  await invoke('pause', 'pending');
  await invoke('resume', 'pending');
  assert.deepEqual(reads, ['thread-exec', 'thread-source', 'thread-source', 'thread-source'], JSON.stringify(replies));
  assert.deepEqual(mutations, []);
  assert.ok(replies.some(reply => /尚未建立執行 thread/.test(reply.content ?? '')));
  assert.ok(replies.some(reply => /尚未 fork/.test(reply.content ?? '')));
  assert.ok(replies.some(reply => /歷史預覽確認/.test(reply.content ?? '')),
    'pending Goal resume cannot execute without the one-shot history handoff');
  assert.ok(replies.every(reply => !String(reply.content ?? '').includes('private objective')));
});

test('Goal start uses the exact selected execution thread and refuses an unfinished Goal', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const replies = [];
  let binding = null, nativeGoal = null, executeArgs = null, executeCount = 0;
  const sessions = {
    get: () => binding,
    set: async (_key, value) => { binding = value; },
    activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0,
    setActiveWorkspace: async () => {}
  };
  const runner = {
    isRunning: () => false, getUsage: async () => null,
    execute: async args => {
      executeCount++; executeArgs = args;
      const threadId = args.resumeSessionId ?? 'thread-created';
      await args.onSessionId(threadId);
      nativeGoal = { threadId, objective: args.goalRun.objective,
        status: 'complete', tokenBudget: args.goalRun.tokenBudget ?? null,
        tokensUsed: 12, timeUsedSeconds: 1 };
      return { sessionId: 'thread-created', exitCode: 0, message: 'done' };
    }
  };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']), goalsEnabled: true,
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  }, goalClientFactory: async () => ({
    getGoal: async ({ threadId }) => ({ goal: nativeGoal?.threadId === threadId ? nativeGoal : null }),
    setGoal: async () => {}, clearGoal: async () => {}, close: async () => {}
  }) });
  const invoke = async () => client.listeners('interactionCreate')[0]({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => 'goal', getSubcommand: () => 'start',
      getString: name => name === 'workspace' ? 'workspace' : 'Build a bounded feature',
      getInteger: () => 900 },
    deferReply: async payload => replies.push({ deferred: payload?.ephemeral ?? false }),
    editReply: async payload => { replies.push(payload); return { id: 'goal-status', edit: async next => replies.push(next) }; },
    reply: async payload => replies.push(payload)
  });

  await invoke();
  assert.equal(executeCount, 1);
  assert.equal(executeArgs.goalRun.objective, 'Build a bounded feature');
  assert.equal(executeArgs.goalRun.tokenBudget, 900);
  assert.equal(executeArgs.resumePolicy, 'fallback');
  assert.equal(binding.sessionId, 'thread-created');
  assert.ok(replies.some(reply => /原生 Goal 活動/.test(reply.content ?? '') && /狀態：complete/.test(reply.content ?? '')));

  nativeGoal.status = 'complete';
  await invoke();
  assert.equal(executeCount, 2);
  assert.equal(executeArgs.resumeSessionId, 'thread-created');
  assert.equal(executeArgs.resumePolicy, 'exact');
  assert.match(executeArgs.goalRun.expectedRevision, /^[a-f0-9]{64}$/);

  nativeGoal = { threadId: 'thread-created', objective: 'unfinished', status: 'paused',
    tokenBudget: 900, tokensUsed: 100, timeUsedSeconds: 5 };
  await invoke();
  assert.equal(executeCount, 2, 'an unfinished native Goal must not start a second Goal run');
  assert.ok(replies.some(reply => /已有原生 Goal/.test(reply.content ?? '')));
  binding = { origin: 'native-selection', sessionId: null, sourceThreadId: 'source-thread', workspace: 'workspace' };
  nativeGoal = { threadId: 'source-thread', objective: 'unfinished source', status: 'active',
    tokenBudget: 900, tokensUsed: 100, timeUsedSeconds: 5 };
  await invoke();
  assert.equal(executeCount, 2, 'a pending source with an unfinished Goal must not be forked or started');
  assert.ok(replies.some(reply => /已有原生 Goal/.test(reply.content ?? '')));
  assert.equal(sessionKey({ userId: 'owner', channelId: 'channel', workspace: 'workspace' }), 'owner:channel:workspace');
});

test('Goal resume requires a resumable native status and resumes only the bound exact thread', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const replies = [];
  const threadId = 'thread-paused';
  let nativeGoal = { threadId, objective: 'Continue the bounded objective', status: 'paused',
    tokenBudget: 1200, tokensUsed: 310, timeUsedSeconds: 20 };
  let executeCount = 0, executeArgs = null, setCalls = 0;
  const sessions = {
    get: () => ({ sessionId: threadId, workspace: 'workspace' }),
    set: async () => {}, activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0
  };
  const runner = {
    isRunning: () => false, getUsage: async () => null,
    execute: async args => {
      executeCount++; executeArgs = args;
      await args.onSessionId(threadId);
      nativeGoal = { ...nativeGoal, status: 'complete' };
      return { sessionId: threadId, exitCode: 0, message: 'done' };
    }
  };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']), goalsEnabled: true,
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  }, goalClientFactory: async () => ({
    getGoal: async ({ threadId: requested }) => ({ goal: requested === nativeGoal.threadId ? nativeGoal : null }),
    setGoal: async () => { setCalls++; }, clearGoal: async () => {}, close: async () => {}
  }) });
  const invoke = async (tokenBudget = null) => client.listeners('interactionCreate')[0]({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => 'goal', getSubcommand: () => 'resume', getString: () => 'workspace',
      getInteger: () => tokenBudget },
    deferReply: async payload => replies.push({ deferred: payload?.ephemeral ?? false }),
    editReply: async payload => { replies.push(payload); return { id: 'goal-status', edit: async next => replies.push(next) }; },
    reply: async payload => replies.push(payload)
  });
  await invoke();
  assert.equal(executeCount, 1);
  assert.equal(executeArgs.goalRun.resume, true);
  assert.equal(executeArgs.goalRun.expectedRevision.length, 64);
  assert.equal(executeArgs.resumeSessionId, threadId);
  assert.equal(executeArgs.resumePolicy, 'exact');
  assert.equal(setCalls, 0, 'native Goal activation belongs to the guarded runner path');
  assert.ok(replies.some(reply => /原生 Goal 活動/.test(reply.content ?? '') && /狀態：complete/.test(reply.content ?? '')));

  nativeGoal = { ...nativeGoal, status: 'budgetLimited' };
  await invoke();
  assert.equal(executeCount, 1, 'budget-limited Goal must not resume implicitly');
  assert.equal(setCalls, 0);
  assert.ok(replies.some(reply => /先提高預算/.test(reply.content ?? '')));

  await invoke(2400);
  assert.equal(executeCount, 2, `settled budget-limited Goal recovery must use a fresh guarded runtime: ${JSON.stringify(replies.slice(-3))}`);
  assert.equal(executeArgs.goalRun.resumeBudgetLimited, true);
  assert.equal(executeArgs.goalRun.tokenBudget, 2400);
  assert.equal(executeArgs.resumeSessionId, threadId);
  assert.equal(executeArgs.resumePolicy, 'exact');
  assert.equal(executeArgs.goalRun.expectedRevision.length, 64);

  nativeGoal = { ...nativeGoal, status: 'active' };
  await invoke();
  assert.equal(executeCount, 2, 'an active Goal without its supervisor must not start a duplicate runner');
  assert.ok(replies.some(reply => /選取該 thread.*確認交接.*fork 到新 thread/.test(reply.content ?? '')));
});

test('active Goal recovery requires history handoff and resumes only a paused fork, leaving source unchanged', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const replies = [];
  const sourceThreadId = 'orphan-active-thread';
  const sourceGoal = { threadId: sourceThreadId, objective: 'Continue the saved objective', status: 'active',
    tokenBudget: null, tokensUsed: 56337, timeUsedSeconds: 75, createdAt: 'created' };
  const targetThreadId = 'recovered-fork-thread';
  let targetGoal = null, binding = { origin: 'native-selection', sessionId: null, workspace: 'workspace',
    source: 'cli', sourceThreadId, sourceLastCompletedTurnId: 'last-completed-turn', sourceUpdatedAt: 123,
    selectionRevision: 2 };
  let executeArgs = null, executeCount = 0;
  const sessions = { get: () => binding,
    set: async (_key, value) => { binding = { ...value, selectionRevision: 2 }; },
    activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0, setActiveWorkspace: async () => {} };
  const runner = { isRunning: () => false, getUsage: async () => null,
    execute: async args => {
      executeCount++;
      executeArgs = args;
      await args.onBeforeFork();
      await args.onSessionId(targetThreadId);
      targetGoal = { ...sourceGoal, threadId: targetThreadId, status: 'paused' };
      await args.onForkPrepared(targetThreadId);
      targetGoal = { ...targetGoal, status: 'complete' };
      return { sessionId: targetThreadId, exitCode: 0, message: 'Recovered work completed.' };
    } };
  const historyAccess = {
    authorizeContext: async () => ({ workspacePath: '/tmp' }),
    assertThreadReadable: async () => {}
  };
  const historyClientFactory = async () => ({
    readThread: async () => ({ thread: { id: sourceThreadId, cwd: '/tmp', source: 'cli', status: 'idle', updatedAt: 123 } }),
    listTurns: async () => ({ data: [{ id: 'last-completed-turn', status: 'completed', startedAt: 100, completedAt: 110 }], nextCursor: null }),
    close: async () => {}
  });
  await startBot({ clientFactory: () => client, runner, sessions, historyAccess, historyClientFactory,
    config: { botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
      goalsEnabled: true, historyEnabled: true,
      workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]]) },
    goalClientFactory: async () => ({
      getGoal: async ({ threadId }) => ({ goal: threadId === sourceThreadId ? sourceGoal
        : threadId === targetThreadId ? targetGoal : null }),
      setGoal: async () => {}, clearGoal: async () => {}, close: async () => {}
    }) });

  const invoke = async (group, action) => client.listeners('interactionCreate')[0]({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => group, getSubcommand: () => action,
      getString: name => name === 'workspace' ? 'workspace' : name === 'task' ? 'Continue normally' : null,
      getBoolean: () => true, getInteger: () => null, getAttachment: () => null },
    deferReply: async payload => replies.push({ deferred: payload?.ephemeral ?? false }),
    editReply: async payload => { replies.push(payload); return { id: 'goal-status', edit: async next => replies.push(next) }; },
    reply: async payload => { replies.push(payload); return { id: 'run-status', edit: async next => replies.push(next) }; },
    fetchReply: async () => ({ id: 'run-status', edit: async next => replies.push(next) })
  });

  await invoke('sessions', 'handoff');
  await invoke(null, 'run');
  assert.equal(executeCount, 1, 'a confirmed handoff can fork an ordinary Codex session around the source Goal');
  assert.equal(executeArgs.goalRun, null);
  assert.equal(executeArgs.prepareForkGoal, true, 'only the inherited fork Goal is paused before ordinary work');
  assert.equal(sourceGoal.status, 'active', 'ordinary work leaves the source Goal untouched');

  binding = { origin: 'native-selection', sessionId: null, workspace: 'workspace', source: 'cli',
    sourceThreadId, sourceLastCompletedTurnId: 'last-completed-turn', sourceUpdatedAt: 123, selectionRevision: 3 };
  await invoke('sessions', 'handoff');
  await client.listeners('messageCreate')[0]({ author: { id: 'owner', bot: false }, guildId: 'guild',
    channelId: 'channel', content: 'Continue normally', attachments: new Map(),
    reply: async payload => { replies.push(payload); return { edit: async next => replies.push(next) }; } });
  assert.equal(executeCount, 2, 'confirmed ordinary messages also run on a prepared fork');
  assert.equal(executeArgs.goalRun, null);
  assert.equal(executeArgs.prepareForkGoal, true);

  binding = { origin: 'native-selection', sessionId: null, workspace: 'workspace', source: 'cli',
    sourceThreadId, sourceLastCompletedTurnId: 'last-completed-turn', sourceUpdatedAt: 123, selectionRevision: 4 };
  await invoke('sessions', 'handoff');
  await invoke('goal', 'resume');
  assert.equal(executeCount, 3);
  assert.equal(executeArgs.goalRun.resume, true);
  assert.equal(executeArgs.goalRun.forkRecovery, true);
  assert.equal(executeArgs.resumeSessionId, null, 'recovery must fork rather than attach to the stale execution thread');
  assert.deepEqual(executeArgs.forkFrom, { threadId: sourceThreadId, lastTurnId: 'last-completed-turn' });
  assert.equal(binding.sessionId, targetThreadId);
  assert.equal(sourceGoal.status, 'active', 'the source Goal must remain unchanged');
  assert.equal(targetGoal.status, 'complete');
  assert.ok(replies.some(reply => /原生 Goal 活動/.test(reply.content ?? '') && /狀態：complete/.test(reply.content ?? '')));
});

test('a new Discord thread automatically pauses and forks a locally controlled active Goal', async () => {
  const client = new EventEmitter(); client.login = async () => {};
  const bindings = new Map();
  const replies = [];
  let nativeGoal = null, forkGoal = null, finishOldRun, oldRunArgs, runCount = 0;
  const sessions = {
    get: key => bindings.get(key) ?? null,
    set: async (key, value) => { bindings.set(key, value); },
    setPendingSelection: async (key, value) => {
      const binding = { ...value, origin: 'native-selection', sessionId: null, selectionRevision: 1 };
      bindings.set(key, binding); return binding;
    },
    bindingRevision: () => 0, runEpoch: () => 0,
    activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0,
    setActiveWorkspace: async () => {}
  };
  const runner = {
    isRunning: key => key === 'owner:workspace' && Boolean(finishOldRun), getUsage: async () => null,
    pauseGoal: async (_key, expected) => {
      assert.equal(expected.threadId, 'old-codex-thread');
      nativeGoal = { ...nativeGoal, status: 'paused' };
      finishOldRun?.();
      return { nativeStatus: 'paused' };
    },
    execute: async args => {
      runCount++;
      if (!args.goalRun?.resume) {
        oldRunArgs = args;
        await args.onSessionId('old-codex-thread');
        nativeGoal = { threadId: 'old-codex-thread', objective: args.goalRun.objective,
          status: 'active', tokenBudget: 900, tokensUsed: 30, timeUsedSeconds: 4, createdAt: 'created' };
        return new Promise(resolve => { finishOldRun = () => {
          finishOldRun = null;
          resolve({ sessionId: 'old-codex-thread', exitCode: 1, message: 'Goal paused', goal: { status: 'paused' } });
        }; });
      }
      assert.equal(args.goalRun.forkRecovery, true);
      await args.onBeforeFork(args.forkFrom);
      await args.onSessionId('forked-codex-thread');
      forkGoal = { ...nativeGoal, threadId: 'forked-codex-thread', status: 'paused' };
      await args.onForkPrepared('forked-codex-thread');
      forkGoal = { ...forkGoal, status: 'complete' };
      return { sessionId: 'forked-codex-thread', exitCode: 0, message: 'Goal completed' };
    }
  };
  const historyAccess = {
    authorizeContext: async () => ({ workspacePath: '/tmp' }),
    assertThreadReadable: async () => {}
  };
  const historyClientFactory = async () => ({
    readThread: async () => ({ thread: { id: 'old-codex-thread', cwd: '/tmp', source: 'appServer',
      status: 'idle', updatedAt: 200 } }),
    listTurns: async () => ({ data: [{ id: 'latest-completed-turn', status: 'completed',
      startedAt: 100, completedAt: 150 }], nextCursor: null }), close: async () => {}
  });
  await startBot({ clientFactory: () => client, runner, sessions, historyAccess, historyClientFactory,
    config: { botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['old-channel', 'new-channel']),
      goalsEnabled: true, historyEnabled: true, workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]]) },
    goalClientFactory: async () => ({
      getGoal: async ({ threadId }) => ({ goal: threadId === 'old-codex-thread' ? nativeGoal
        : threadId === 'forked-codex-thread' ? forkGoal : null }),
      setGoal: async ({ threadId, status }) => { if (threadId === 'old-codex-thread') nativeGoal = { ...nativeGoal, status }; },
      clearGoal: async () => {}, close: async () => {}
    }) });
  const invoke = async (channelId, action, objective = null) => client.listeners('interactionCreate')[0]({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId, channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => 'goal', getSubcommand: () => action,
      getString: name => name === 'workspace' ? 'workspace' : name === 'objective' ? objective : null,
      getInteger: () => null },
    deferReply: async () => {},
    editReply: async payload => { replies.push(payload); return { id: `status-${channelId}`, channelId,
      edit: async next => replies.push(next) }; }, reply: async payload => replies.push(payload)
  });

  const oldRun = invoke('old-channel', 'start', 'Continue the bounded Goal');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nativeGoal.status, 'active');
  await invoke('new-channel', 'resume');
  await oldRun;
  assert.equal(runCount, 2);
  assert.equal(nativeGoal.status, 'paused', 'automatic handoff stops the original Goal');
  assert.equal(oldRunArgs.forkFrom, null);
  assert.equal(bindings.get('owner:new-channel:workspace').sessionId, 'forked-codex-thread');
  assert.equal(forkGoal.status, 'complete');
  assert.ok(replies.some(reply => /正在暫停舊 Goal/.test(reply.content ?? '')));
});

test('Goal budget updates only paused execution Goals and verifies native read-back', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const replies = [];
  let binding = { sessionId: 'thread-budget', workspace: 'workspace' };
  let nativeGoal = { threadId: 'thread-budget', objective: 'Budgeted objective', status: 'paused',
    tokenBudget: 500, tokensUsed: 100, timeUsedSeconds: 8, createdAt: 'created' };
  let sets = 0, clientFactories = 0, requestedBudget = 700;
  const sessions = { get: () => binding, activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0 };
  const runner = { isRunning: () => false, getUsage: async () => null, execute: async () => { throw new Error('unexpected run'); } };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']), goalsEnabled: true,
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }], ['pending', { path: '/tmp', allowNonGit: true }]])
  }, goalClientFactory: async () => {
    clientFactories++;
    return {
      getGoal: async ({ threadId }) => ({ goal: threadId === nativeGoal.threadId ? nativeGoal : null }),
      setGoal: async params => { sets++; nativeGoal = { ...nativeGoal, ...params }; },
      clearGoal: async () => {}, close: async () => {}
    };
  } });
  const invoke = async workspaceName => client.listeners('interactionCreate')[0]({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => 'goal', getSubcommand: () => 'budget', getString: () => workspaceName,
      getInteger: () => requestedBudget },
    deferReply: async payload => replies.push({ deferred: payload.ephemeral }),
    editReply: async payload => { replies.push(payload); return { id: 'goal-budget', edit: async next => replies.push(next) }; },
    reply: async payload => replies.push(payload)
  });

  await invoke('workspace');
  assert.equal(sets, 1);
  assert.equal(nativeGoal.tokenBudget, 700);
  assert.equal(nativeGoal.tokensUsed, 100);
  assert.equal(nativeGoal.status, 'paused');
  assert.ok(replies.some(reply => /更新已讀回確認/.test(reply.content ?? '')));

  requestedBudget = 100;
  await invoke('workspace');
  assert.equal(sets, 1, 'a total budget at or below consumed tokens must be refused');
  requestedBudget = 700;
  nativeGoal = { ...nativeGoal, status: 'active' };
  await invoke('workspace');
  assert.equal(sets, 1, 'active Goal budget changes must not write native state');
  nativeGoal = { ...nativeGoal, status: 'budgetLimited' };
  await invoke('workspace');
  assert.equal(sets, 1, 'budget-limited update requires its dedicated supervisor');

  binding = { origin: 'native-selection', sessionId: null, sourceThreadId: 'thread-budget', workspace: 'pending' };
  const pendingBinding = binding;
  const beforePending = clientFactories;
  await invoke('pending');
  assert.equal(clientFactories, beforePending, 'pending selection must not even open a mutating Goal client');
  assert.equal(sets, 1);
  assert.equal(binding, pendingBinding, 'a refused pending-source budget change must preserve the selection binding');
  assert.ok(replies.some(reply => /仍是唯讀狀態.*沒有 fork，也沒有修改來源 Goal/.test(reply.content ?? '')));
});

test('budgetLimited Goal budget and resume commands route through its live runtime supervisor', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const replies = [];
  const threadId = 'thread-budget-supervised';
  let binding = null, nativeGoal = null, running = false, finishRun, markStarted, resumeCalls = 0;
  const started = new Promise(resolve => { markStarted = resolve; });
  const sessions = { get: () => binding, set: async (_key, value) => { binding = value; },
    activeWorkspace: () => 'workspace', activeModel: () => null, activeReasoningEffort: () => null,
    progressLineCount: () => 0, setActiveWorkspace: async () => {} };
  const runner = {
    isRunning: () => running, getUsage: async () => null,
    execute: async args => {
      running = true;
      await args.onSessionId(threadId);
      nativeGoal = { threadId, objective: args.goalRun.objective, status: 'active', tokenBudget: 500,
        tokensUsed: 100, timeUsedSeconds: 8, createdAt: 'created' };
      markStarted();
      return await new Promise(resolve => { finishRun = () => {
        nativeGoal = { ...nativeGoal, status: 'complete' };
        running = false;
        resolve({ sessionId: threadId, exitCode: 0, message: 'done' });
      }; });
    },
    setGoalBudget: async (key, tokenBudget, revision) => {
      assert.equal(key, 'owner:workspace');
      assert.equal(revision.length, 64);
      assert.equal(nativeGoal.status, 'budgetLimited');
      nativeGoal = { ...nativeGoal, tokenBudget, updatedAt: 'updated' };
      return true;
    },
    resumeBudgetLimitedGoal: async (key, revision) => {
      resumeCalls++;
      assert.equal(key, 'owner:workspace');
      assert.equal(revision.length, 64);
      assert.equal(nativeGoal.status, 'budgetLimited');
      nativeGoal = { ...nativeGoal, status: 'active' };
      return true;
    }
  };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']), goalsEnabled: true,
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  }, goalClientFactory: async () => ({
    getGoal: async ({ threadId: requested }) => ({ goal: requested === nativeGoal?.threadId ? nativeGoal : null }),
    setGoal: async () => {}, clearGoal: async () => {}, close: async () => {}
  }) });
  const invoke = (action, tokenBudget = null) => client.listeners('interactionCreate')[0]({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => 'goal', getSubcommand: () => action,
      getString: name => name === 'workspace' ? 'workspace' : 'Create a bounded Goal', getInteger: () => tokenBudget },
    deferReply: async payload => replies.push({ deferred: payload.ephemeral }),
    editReply: async payload => { replies.push(payload); return { id: 'goal-supervisor-status',
      edit: async next => replies.push(next), channel: { send: async () => {} } }; },
    reply: async payload => replies.push(payload)
  });
  const startPromise = invoke('start');
  await started;
  nativeGoal = { ...nativeGoal, status: 'budgetLimited' };
  await invoke('budget', 900);
  assert.equal(nativeGoal.tokenBudget, 900);
  assert.equal(nativeGoal.status, 'budgetLimited', 'budget command alone must not resume the Goal');
  assert.equal(running, true, 'the budget-limited controller and its lease remain alive');
  nativeGoal = { ...nativeGoal, tokensUsed: null };
  const beforeUnknownUsage = replies.length;
  await invoke('resume');
  assert.equal(resumeCalls, 0, 'unknown usage must not reach the runtime resume operation');
  assert.ok(replies.slice(beforeUnknownUsage).some(reply => String(reply.content ?? '').includes('無法確認 Goal 已使用 tokens')));
  nativeGoal = { ...nativeGoal, tokensUsed: 100 };
  await invoke('resume');
  assert.equal(resumeCalls, 1);
  assert.equal(nativeGoal.status, 'active', 'explicit resume is routed to the existing supervisor');
  finishRun();
  await startPromise;
  assert.ok(replies.some(reply => /由現有 supervisor 明確恢復/.test(reply.content ?? '')));
});

test('private Goal activity controls bind to owner, channel, run, thread and current turn', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const replies = [], cards = [], buttonReplies = [], approvalMessages = [];
  const steeringCalls = [], steeringReactions = [];
  const approvalCalls = [], answerCalls = [], shownModals = [];
  const threadId = 'private-goal-thread', turnOne = 'private-turn-one', turnTwo = 'private-turn-two';
  let binding = null, nativeGoal = null, running = false, finishRun, emitProgress, markReady;
  let selectedModel = 'gpt-5.6-sol', selectedEffort = 'low', executionModel = null, executionEffort = null;
  let pauseCalls = 0, readCalls = 0, raceNextRead = false, expireNextRead = false;
  let fakeNow = Date.now(), runtimeTurnId = null, runtimeTurnsSeen = 0;
  const ready = new Promise(resolve => { markReady = resolve; });
  const sessions = { get: () => binding, set: async (_key, value) => { binding = value; },
    activeWorkspace: () => 'workspace', activeModel: () => selectedModel, activeReasoningEffort: () => selectedEffort,
    setActiveModel: async (_key, value) => { selectedModel = value; },
    setActiveReasoningEffort: async (_key, value) => { selectedEffort = value; },
    progressLineCount: () => 0, setActiveWorkspace: async () => {} };
  const runner = {
    isRunning: () => running, getUsage: async () => null,
    steer: async (key, input) => { steeringCalls.push({ key, ...input }); return true; },
    approve: (key, requestId, choice) => { approvalCalls.push({ key, requestId, choice }); return true; },
    answerUserInput: (key, requestId, answers) => { answerCalls.push({ key, requestId, answers }); return true; },
    execute: async args => {
      executionModel = args.model;
      executionEffort = args.reasoningEffort;
      running = true;
      await args.onSessionId(threadId);
      nativeGoal = { threadId, objective: args.goalRun.objective, status: 'active', tokenBudget: 1500,
        tokensUsed: 240, timeUsedSeconds: 12, createdAt: 'created' };
      emitProgress = async event => {
        if (event.method === 'turn/started') {
          runtimeTurnId = event.params?.turn?.id ?? event.params?.turnId;
          if (Number.isSafeInteger(event.params?.turn?.index)) runtimeTurnsSeen = Math.max(runtimeTurnsSeen, event.params.turn.index + 1);
        } else if (event.method === 'bridge/goalStatus') {
          if (Number.isSafeInteger(event.params?.turnsSeen)) runtimeTurnsSeen = Math.max(runtimeTurnsSeen, event.params.turnsSeen);
          if (event.params?.turnInFlight === false) runtimeTurnId = null;
          else if (typeof event.params?.turnId === 'string') runtimeTurnId = event.params.turnId;
        }
        return args.onProgress(event);
      };
      await emitProgress({ method: 'bridge/goalStatus', params: { status: 'active', turnsSeen: 1,
        turnsCompleted: 0, turnInFlight: true, tokenBudget: 1500, tokensUsed: 240 } });
      await emitProgress({ method: 'turn/started', params: { threadId, turn: { id: turnOne } } });
      await args.onApproval({ kind: 'command', requestId: 'approval-1', command: 'cat /tmp/private/secret.txt',
        cwd: '/tmp/private', reason: 'Private approval detail.' });
      await args.onUserInput({ kind: 'user-input', requestId: 'input-1', questions: [{ id: 'choice',
        header: 'Choice', question: 'Which branch should be used?', isSecret: false,
        options: [{ label: 'A', description: 'First branch' }] }] });
      markReady();
      return await new Promise(resolve => { finishRun = () => {
        nativeGoal = { ...nativeGoal, status: 'complete' };
        running = false;
        resolve({ sessionId: threadId, exitCode: 0, message: 'internal final output must not be in Goal card' });
      }; });
    },
    pauseGoal: async (key, expected) => {
      assert.equal(key, 'owner:workspace');
      if (expected.turnId !== runtimeTurnId || expected.turnsSeen !== runtimeTurnsSeen) {
        throw Object.assign(new Error('Goal turn changed during control read'), { code: 'GOAL_TURN_CONFLICT' });
      }
      pauseCalls++;
      assert.deepEqual(expected, { threadId, turnId: turnTwo, turnsSeen: 2 });
      nativeGoal = { ...nativeGoal, status: 'paused' }; return true;
    }
  };
  const models = [
    { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', inputModalities: ['text'], defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
    { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', inputModalities: ['text'], defaultReasoningEffort: 'low',
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }
  ];
  await startBot({ clientFactory: () => client, runner, sessions, models, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']), goalsEnabled: true,
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  }, now: () => fakeNow, goalClientFactory: async () => ({
    getGoal: async ({ threadId: requested }) => {
      readCalls++;
      if (expireNextRead) {
        expireNextRead = false;
        fakeNow = Date.now() + 31 * 60_000;
      }
      if (raceNextRead) {
        raceNextRead = false;
        await emitProgress({ method: 'turn/started', params: { threadId, turn: { id: turnTwo } } });
        await emitProgress({ method: 'bridge/goalStatus', params: { status: 'active', turnsSeen: 2,
          turnsCompleted: 1, turnInFlight: true, turnId: turnTwo, tokenBudget: 1500, tokensUsed: 240 } });
      }
      return { goal: requested === threadId ? nativeGoal : null };
    },
    setGoal: async () => {}, clearGoal: async () => {}, close: async () => {}
  }) });
  const startPromise = client.listeners('interactionCreate')[0]({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => 'goal', getSubcommand: () => 'start',
      getString: name => name === 'workspace' ? 'workspace' : 'Complete the bounded private activity card', getInteger: () => null },
    deferReply: async payload => replies.push({ deferred: payload.ephemeral }),
    editReply: async payload => { replies.push(payload); return { id: 'goal-activity-status',
      edit: async next => cards.push(next), channel: { send: async () => {} } }; },
    followUp: async payload => { approvalMessages.push(payload); return { id: 'approval-card', edit: async next => cards.push(next) }; },
    reply: async payload => replies.push(payload)
  });
  await ready;
  assert.equal(executionModel, 'gpt-5.6-sol');
  assert.equal(executionEffort, 'low');
  const settingReplies = [];
  const setConversationOption = (action, value) => client.listeners('interactionCreate')[0]({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => null, getSubcommand: () => action,
      getString: name => name === 'name' ? value : value },
    reply: async payload => settingReplies.push(payload)
  });
  await setConversationOption('model', 'gpt-5.6-luna');
  assert.equal(selectedModel, 'gpt-5.6-luna');
  assert.equal(selectedEffort, null, 'choosing another channel model resets only the future default effort');
  await setConversationOption('reasoning', 'high');
  assert.equal(selectedEffort, 'high');
  assert.equal(executionModel, 'gpt-5.6-sol', 'model changes do not mutate the active Goal thread');
  assert.equal(executionEffort, 'low', 'effort changes do not mutate the active Goal thread');
  assert.equal(settingReplies.length, 2);
  assert.ok(settingReplies.every(reply => /active Goal keeps the model and reasoning depth captured when it started/.test(reply.content)));
  const button = (payload, label) => payload.components.flatMap(row => row.toJSON().components)
    .find(component => component.label === label)?.custom_id;
  let card = cards.at(-1);
  assert.match(card.content, /原生 Goal 活動/);
  assert.match(card.content, /狀態：active/);
  assert.match(card.content, /目前回合：第 1 輪執行中/);
  assert.match(card.content, /用量：240 \/ 1500 tokens/);
  assert.doesNotMatch(card.content, /private-goal-thread|private-turn-one|internal final output/);
  assert.doesNotMatch(card.content, /approval-1|secret\.txt|Private approval detail|Which branch/);
  assert.equal(approvalMessages.length, 2);
  assert.equal(approvalMessages[0].ephemeral, true);
  assert.match(approvalMessages[0].content, /Private approval detail/);
  assert.equal(approvalMessages[1].ephemeral, true);
  assert.match(approvalMessages[1].content, /Which branch should be used/);

  const messageHandler = client.listeners('messageCreate')[0];
  await messageHandler({ author: { id: 'owner', bot: false }, guildId: 'guild', channelId: 'channel',
    content: 'Focus on verifying the current Goal step.', attachments: new Map(),
    react: async reaction => steeringReactions.push(reaction), reply: async payload => replies.push(payload) });
  assert.deepEqual(steeringCalls, [{ key: 'owner:workspace', prompt: 'Focus on verifying the current Goal step.',
    imageUrls: [], clientUserMessageId: undefined }], 'an unreferenced owner message in the bound channel steers the unique live Goal');
  assert.deepEqual(steeringReactions, ['↪️']);
  await messageHandler({ author: { id: 'owner', bot: false }, guildId: 'guild', channelId: 'channel',
    content: 'Do not attach this to the Goal.', reference: { messageId: 'unrelated-message' },
    attachments: new Map(), react: async reaction => steeringReactions.push(reaction), reply: async payload => replies.push(payload) });
  assert.equal(steeringCalls.length, 1, 'a reply to an unrelated message is not implicitly steered to the Goal');

  const staleTurnPause = button(card, '暫停 Goal');
  assert.ok(staleTurnPause);

  const click = (customId, { userId = 'owner', channelId = 'channel', messageId = 'goal-activity-status' } = {}) => client.listeners('interactionCreate')[0]({
    isButton: () => true, customId, user: { id: userId }, guildId: 'guild', channelId,
    message: { id: messageId }, deferUpdate: async () => {},
    reply: async payload => buttonReplies.push(payload), followUp: async payload => buttonReplies.push(payload)
  });
  const approvalButton = approvalMessages[0].components.flatMap(row => row.toJSON().components)
    .find(component => component.label === '允許一次').custom_id;
  const inputButton = approvalMessages[1].components.flatMap(row => row.toJSON().components)
    .find(component => component.label === '回答問題').custom_id;
  const invokeControl = (customId, userId = 'owner') => client.listeners('interactionCreate')[0]({
    isButton: () => true, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => false,
    customId, user: { id: userId }, guildId: 'guild', channelId: 'channel',
    deferUpdate: async () => {}, update: async payload => buttonReplies.push(payload),
    message: { id: 'private-control', edit: async payload => buttonReplies.push(payload) },
    showModal: async modal => shownModals.push(modal),
    reply: async payload => buttonReplies.push(payload), followUp: async payload => buttonReplies.push(payload)
  });
  const submitInput = (customId, userId = 'owner') => client.listeners('interactionCreate')[0]({
    isButton: () => false, isModalSubmit: () => true, isAutocomplete: () => false, isChatInputCommand: () => false,
    customId, user: { id: userId }, guildId: 'guild', channelId: 'channel', message: { id: 'private-control' },
    fields: { getTextInputValue: () => '1' },
    reply: async payload => buttonReplies.push(payload)
  });
  await invokeControl(approvalButton, 'intruder');
  assert.equal(approvalCalls.length, 0, 'a different user cannot answer a Goal approval');
  await invokeControl(approvalButton);
  assert.deepEqual(approvalCalls, [{ key: 'owner:workspace', requestId: 'approval-1', choice: 'allow' }]);
  await invokeControl(inputButton, 'intruder');
  assert.equal(shownModals.length, 0, 'a different user cannot open a Goal user-input modal');
  assert.equal(answerCalls.length, 0);
  await invokeControl(inputButton);
  const inputModalId = shownModals[0].toJSON().custom_id;
  await submitInput(inputModalId, 'intruder');
  assert.equal(answerCalls.length, 0, 'a different user cannot submit a Goal user-input modal');
  await submitInput(inputModalId);
  assert.equal(answerCalls.length, 1);
  assert.equal(answerCalls[0].key, 'owner:workspace');
  assert.equal(answerCalls[0].requestId, 'input-1');
  assert.deepEqual(answerCalls[0].answers.choice, { answers: ['A'] });
  const readsBeforeUnauthorized = readCalls;
  await click(button(card, '更新狀態'), { userId: 'other' });
  assert.equal(readCalls, readsBeforeUnauthorized, 'foreign users cannot trigger even a status read');
  await click(button(card, '更新狀態'), { channelId: 'other-channel' });
  await click(button(card, '更新狀態'), { messageId: 'other-message' });
  assert.equal(readCalls, readsBeforeUnauthorized, 'foreign channels and messages cannot trigger status reads');
  assert.equal(pauseCalls, 0);

  const staleAfterExpiry = button(card, '更新狀態');
  const cardsBeforeExpiry = cards.length;
  const readsBeforeExpiry = readCalls;
  fakeNow += 31 * 60_000;
  await click(staleAfterExpiry);
  fakeNow = Date.now();
  assert.equal(readCalls, readsBeforeExpiry, 'expired controls must be rejected before native reads');
  assert.equal(cards.length, cardsBeforeExpiry);
  assert.match(buttonReplies.at(-1).content, /已過期/);

  const expiresDuringRead = button(card, '暫停 Goal');
  const pausesBeforeReadExpiry = pauseCalls;
  const statusBeforeReadExpiry = nativeGoal.status;
  const cardsBeforeReadExpiry = cards.length;
  const readsBeforeReadExpiry = readCalls;
  expireNextRead = true;
  await click(expiresDuringRead);
  fakeNow = Date.now();
  assert.equal(readCalls, readsBeforeReadExpiry + 1, 'the control passes the initial gate and expires during native read');
  assert.equal(cards.length, cardsBeforeReadExpiry, 'a control that expires during native read must not refresh the card');
  assert.equal(pauseCalls, pausesBeforeReadExpiry, 'a control that expires during native read must not pause the Goal');
  assert.equal(nativeGoal.status, statusBeforeReadExpiry, 'expiry before pause mutation must preserve native Goal state');
  assert.match(buttonReplies.at(-1).content, /已過期/);

  raceNextRead = true;
  await click(staleTurnPause);
  assert.equal(pauseCalls, 0, 'a control bound to an earlier turn must be stale');
  assert.ok(buttonReplies.some(reply => /回合已改變/.test(reply.content ?? '')),
    'runtime compare-and-pause rejects a turn that advanced during the native status read');

  card = cards.at(-1);
  const currentPause = button(card, '暫停 Goal');
  assert.ok(currentPause);
  await click(currentPause);
  assert.equal(pauseCalls, 1);
  assert.ok(buttonReplies.some(reply => /暫停已由 native read-back 確認/.test(reply.content ?? '')));
  card = cards.at(-1);
  assert.match(card.content, /狀態：paused/);
  assert.equal(button(card, '暫停 Goal'), undefined, 'paused Goal cards expose status only');

  finishRun();
  await startPromise;
  assert.equal(binding.sessionId, threadId);
  const readsBeforeStaleRun = readCalls;
  await click(currentPause);
  assert.equal(pauseCalls, 1, 'a button from a finished run cannot address a later controller');
  assert.equal(readCalls, readsBeforeStaleRun);

  const restartedClient = new EventEmitter();
  restartedClient.login = async () => {};
  let restartedPauses = 0;
  await startBot({ clientFactory: () => restartedClient,
    runner: { isRunning: () => false, pauseGoal: () => { restartedPauses++; return true; }, getUsage: async () => null },
    sessions, config: { botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
      goalsEnabled: true, workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]]) },
    goalClientFactory: async () => ({ getGoal: async () => ({ goal: nativeGoal }),
      setGoal: async () => {}, clearGoal: async () => {}, close: async () => {} }) });
  await restartedClient.listeners('interactionCreate')[0]({ isButton: () => true, isModalSubmit: () => false,
    isAutocomplete: () => false, isChatInputCommand: () => false, customId: currentPause,
    user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', message: { id: 'private-control' },
    reply: async payload => buttonReplies.push(payload), update: async payload => buttonReplies.push(payload) });
  assert.equal(restartedPauses, 0, 'a prior process Goal control cannot mutate after Bot restart');
  assert.match(buttonReplies.at(-1).content, /已過期/);
});

test('Goal clear requires a stopped execution Goal, reads back absence and preserves the session binding', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const replies = [];
  let binding = { sessionId: 'thread-clear', workspace: 'workspace' };
  let nativeGoal = { threadId: 'thread-clear', objective: 'Clearable objective', status: 'paused',
    tokenBudget: 800, tokensUsed: 220, timeUsedSeconds: 12 };
  let clears = 0, clientFactories = 0;
  const sessions = { get: () => binding, activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0 };
  const runner = { isRunning: () => false, getUsage: async () => null, execute: async () => { throw new Error('unexpected run'); } };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']), goalsEnabled: true,
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }], ['pending', { path: '/tmp', allowNonGit: true }]])
  }, goalClientFactory: async () => {
    clientFactories++;
    return {
      getGoal: async ({ threadId }) => ({ goal: threadId === nativeGoal?.threadId ? nativeGoal : null }),
      setGoal: async () => {},
      clearGoal: async ({ threadId }) => { clears++; if (threadId === nativeGoal.threadId) nativeGoal = null; },
      close: async () => {}
    };
  } });
  const invoke = async workspaceName => client.listeners('interactionCreate')[0]({
    commandName: 'codex', user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => 'goal', getSubcommand: () => 'clear', getString: () => workspaceName },
    deferReply: async payload => replies.push({ deferred: payload.ephemeral }),
    editReply: async payload => { replies.push(payload); return { id: 'goal-clear', edit: async next => replies.push(next) }; },
    reply: async payload => replies.push(payload)
  });

  await invoke('workspace');
  assert.equal(clears, 1);
  assert.equal(nativeGoal, null, 'native clear must be confirmed by a later get read-back');
  assert.equal(binding.sessionId, 'thread-clear', 'clearing a Goal must not forget the conversation binding');
  assert.ok(replies.some(reply => /已清除並經 read-back 確認/.test(reply.content ?? '')));

  nativeGoal = { threadId: 'thread-clear', objective: 'Active objective', status: 'active', tokenBudget: 800,
    tokensUsed: 220, timeUsedSeconds: 12 };
  await invoke('workspace');
  assert.equal(clears, 1, 'an active native Goal must not be cleared');

  binding = { origin: 'native-selection', sessionId: null, sourceThreadId: 'thread-clear', workspace: 'pending' };
  const pendingBinding = binding;
  const beforePending = clientFactories;
  await invoke('pending');
  assert.equal(clientFactories, beforePending, 'pending source must be rejected before Goal RPC');
  assert.equal(clears, 1);
  assert.equal(binding, pendingBinding, 'a refused pending-source clear must preserve the selection binding');
  assert.equal(nativeGoal.threadId, 'thread-clear', 'the pending source Goal must remain intact');
  assert.ok(replies.some(reply => /仍是唯讀狀態.*沒有 fork，也沒有修改來源 Goal/.test(reply.content ?? '')));
});

test('after Bot restart, old approval and input buttons cannot call the runner', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  let approvals = 0, answers = 0;
  const runner = { isRunning: () => false, getUsage: async () => null,
    approve: () => { approvals++; return true; }, answerUserInput: () => { answers++; return true; } };
  const sessions = { activeWorkspace: () => 'workspace', activeModel: () => null,
    activeReasoningEffort: () => null, progressLineCount: () => 0 };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  } });

  const responses = [];
  const interaction = customId => ({ customId, user: { id: 'owner' }, guildId: 'guild', channelId: 'channel',
    channel: {}, isButton: () => true, isModalSubmit: () => false, isAutocomplete: () => false,
    isChatInputCommand: () => false, update: async payload => responses.push(payload),
    followUp: async payload => responses.push(payload), reply: async payload => responses.push(payload) });
  await client.listeners('interactionCreate')[0](interaction('codex:approval:previous-process-token:allow'));
  await client.listeners('interactionCreate')[0](interaction('codex:input:previous-process-token'));
  assert.equal(approvals, 0);
  assert.equal(answers, 0);
  assert.match(responses[1].content, /no longer active/);
  assert.match(responses[2].content, /已失效/);
});

test('after Bot restart, an ordinary message cannot implicitly resume an unfinished native Goal', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const responses = [];
  let executeCalls = 0, goalReads = 0, goalCloses = 0;
  const sessions = { get: () => ({ sessionId: 'saved-goal-thread', workspace: 'workspace' }),
    activeWorkspace: () => 'workspace', activeModel: () => null, activeReasoningEffort: () => null,
    progressLineCount: () => 0 };
  const runner = { isRunning: () => false, getUsage: async () => null,
    execute: async () => { executeCalls++; throw new Error('unexpected implicit resume'); } };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  }, goalClientFactory: async () => ({
    getGoal: async ({ threadId }) => { goalReads++; return { goal: {
      threadId, objective: 'private objective', status: 'active', tokenBudget: 500, tokensUsed: 90
    } }; },
    setGoal: async () => {}, clearGoal: async () => {},
    close: async () => { goalCloses++; }
  }) });

  await client.listeners('messageCreate')[0]({ author: { id: 'owner', bot: false }, guildId: 'guild',
    channelId: 'channel', content: 'Continue the work', attachments: new Map(),
    reply: async payload => {
      const response = { content: payload.content, edit: async next => responses.push(next) };
      responses.push(payload);
      return response;
    } });

  assert.equal(goalReads, 1, JSON.stringify(responses));
  assert.equal(goalCloses, 1);
  assert.equal(executeCalls, 0, 'no runner turn starts while an unfinished native Goal needs explicit recovery');
  assert.ok(responses.some(response => /未完成的原生 Goal/.test(response.content ?? '')
    && /選取來源、確認交接/.test(response.content ?? '')
    && /`\/codex goal resume`/.test(response.content ?? '')), JSON.stringify(responses));
  assert.ok(responses.every(response => !String(response.content ?? '').includes('private objective')));
});

test('ordinary messages continue on a prepared fork while its inherited Goal stays paused', async () => {
  const client = new EventEmitter(); client.login = async () => {};
  const responses = [];
  let executeArgs = null;
  const sessions = { get: () => ({ sessionId: 'fork-session', workspace: 'workspace', origin: 'native-fork',
    sourceThreadId: 'source-thread', sourceLastCompletedTurnId: 'source-turn', forkGoalPrepared: true }),
    activeWorkspace: () => 'workspace', activeModel: () => null, activeReasoningEffort: () => null,
    progressLineCount: () => 0 };
  const runner = { isRunning: () => false, getUsage: async () => null,
    execute: async args => { executeArgs = args; return { sessionId: 'fork-session', exitCode: 0, message: 'Ready' }; } };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
    workspaces: new Map([['workspace', { path: '/tmp', allowNonGit: true }]])
  }, goalClientFactory: async () => ({ getGoal: async ({ threadId }) => ({ goal: {
    threadId, objective: 'Paused native objective', status: 'paused', tokenBudget: 500, tokensUsed: 90
  } }), setGoal: async () => {}, clearGoal: async () => {}, close: async () => {} }) });
  await client.listeners('messageCreate')[0]({ author: { id: 'owner', bot: false }, guildId: 'guild',
    channelId: 'channel', channel: {}, content: 'What remains to do?', attachments: new Map(),
    reply: async payload => { responses.push(payload); return { id: 'status-card', edit: async value => responses.push(value) }; } });
  assert.ok(executeArgs, JSON.stringify(responses));
  assert.equal(executeArgs.resumeSessionId, 'fork-session');
  assert.equal(executeArgs.goalRun, null);
  assert.equal(executeArgs.prepareForkGoal, false, 'normal conversation must not reactivate the paused Goal');
  assert.ok(responses.some(response => /Ready/.test(response.content ?? '')));
});

test('messages in an existing Discord thread resume its workspace session and stay in that thread', async () => {
  const client = new EventEmitter(); client.login = async () => {};
  const replies = [], threadMessages = [], bindings = new Map();
  const bindingKey = sessionKey({ userId: 'owner', channelId: 'discussion-thread', workspace: 'totem-core' });
  bindings.set(bindingKey, { sessionId: 'existing-codex-session', workspace: 'totem-core' });
  const selectedWorkspaces = new Map();
  const sessions = {
    get: key => bindings.get(key) ?? null,
    set: async (key, value) => bindings.set(key, value),
    activeWorkspace: key => selectedWorkspaces.get(key) ?? null,
    setActiveWorkspace: async (key, workspace) => selectedWorkspaces.set(key, workspace),
    activeModel: () => null, activeReasoningEffort: () => null, progressLineCount: () => 0
  };
  let execution = null, renamedThread = null, parentThreadStarts = 0;
  const runner = { isRunning: () => false, getUsage: async () => null,
    execute: async args => {
      execution = args;
      await args.onSessionId('existing-codex-session');
      return { sessionId: 'existing-codex-session', exitCode: 0, message: 'continued' };
    } };
  await startBot({ clientFactory: () => client, runner, sessions, config: {
    botToken: 'test', allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['parent']),
    workspaces: new Map([
      ['workspace', { path: '/repo', allowNonGit: true }],
      ['totem-core', { path: '/repo/TotemCore', allowNonGit: false }]
    ])
  } });
  const channel = {
    id: 'discussion-thread', parentId: 'parent', parent: { id: 'parent', send: async () => {
      parentThreadStarts++;
      throw new Error('must not create a sibling thread');
    } },
    name: 'Existing discussion', isThread: () => true,
    setName: async name => { renamedThread = name; },
    send: async payload => {
      threadMessages.push(payload);
      return { id: 'thread-status', edit: async next => threadMessages.push(next) };
    }
  };
  await client.listeners('messageCreate')[0]({ author: { id: 'owner', bot: false }, guildId: 'guild',
    channelId: 'discussion-thread', channel, content: 'Continue here', attachments: new Map(),
    reply: async payload => { replies.push(payload); return { id: 'reply', edit: async next => replies.push(next) }; } });

  assert.equal(execution.workspace, '/repo/TotemCore');
  assert.equal(execution.resumeSessionId, 'existing-codex-session');
  assert.equal(execution.prompt, 'Continue here');
  assert.equal(parentThreadStarts, 0, 'messages in an existing thread never create a sibling thread');
  assert.equal(renamedThread, '[totem-core] Existing discussion');
  assert.ok(threadMessages.some(payload => /totem-core/.test(payload.content ?? '')),
    'the in-thread status also marks the selected workspace');
  assert.deepEqual(replies, []);
});

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

test('sessions list and preview stay ephemeral, use authorization, and never start a model turn', async () => {
  const client = new EventEmitter();
  client.login = async () => {};
  const calls = { execute: 0, listed: 0, listParams: [], closed: 0, cursorWorkspace: null }, replies = [];
  const runner = { isRunning: () => false, execute: async () => { calls.execute++; }, getUsage: async () => null };
  const sessions = { get: () => null, bindingRevision: () => 0 };
  const config = { botToken: 'test', guildId: 'guild', historyEnabled: true,
    allowedUserIds: new Set(['owner']), allowedChannelIds: new Set(['channel']),
    workspaces: new Map([['workspace', { path: '/work' }]]) };
  const historyAccess = {
    authorizeContext: async () => ({ workspacePath: '/work' }),
    filterThreads: async (_context, threads) => threads,
    issueCandidate: async () => ({ token: 'C'.repeat(32) }),
    issueCursor: async () => ({ token: 'P'.repeat(32) }),
    resolveCursor: async (context, { token }) => {
      calls.cursorWorkspace = context.workspaceName;
      assert.equal(token, 'P'.repeat(32));
      return { cursors: [{ cwd: '/work', cursor: 'page-2' }], workspaceName: context.workspaceName };
    },
    resolveCandidate: async (_context, { readMetadata }) => {
      await readMetadata({ threadId: 'thread-1', cwd: '/work', sourceKinds: ['cli'] });
      return { threadId: 'thread-1', source: 'cli' };
    }
  };
  const historyClientFactory = async () => ({
    listThreads: async params => { calls.listed++; calls.listParams.push(params); return { data: [
      { id: 'thread-1', title: `Private ${privatePath}`, source: 'cli', cwd: '/work', updatedAt: 1, archived: false }
    ], nextCursor: calls.listed === 1 ? 'server-page-token' : null }; },
    readThread: async () => ({ thread: { id: 'thread-1', title: 'Private', source: 'cli', cwd: '/work' } }),
    listTurns: async () => ({ data: [{ id: 'turn-1', status: 'completed' }], nextCursor: null }),
    listItems: async () => ({ data: [
      { turnId: 'turn-1', item: { type: 'userMessage', content: [{ type: 'text', text: 'Hello https://private.invalid' }] } },
      { turnId: 'turn-1', item: { type: 'agentMessage', text: 'Bearer abc.def' } },
      { turnId: 'turn-1', item: { type: 'reasoning', text: 'do not show' } }
    ], nextCursor: null }),
    close: async () => { calls.closed++; }
  });
  await startBot({ clientFactory: () => client, runner, sessions, config, historyAccess, historyClientFactory });
  const common = { user: { id: 'owner' }, guildId: 'guild', channelId: 'channel', channel: {},
    commandName: 'codex', isButton: () => false, isModalSubmit: () => false,
    isAutocomplete: () => false, isChatInputCommand: () => true };
  const listInteraction = { ...common,
    options: { getSubcommandGroup: () => 'sessions', getSubcommand: () => 'list',
      getString: name => ({ workspace: 'workspace', query: '', source: 'all' })[name] },
    deferred: false, deferReply: async function (payload) { this.deferred = true; replies.push({ deferred: payload }); },
    editReply: async payload => { replies.push({ list: payload }); } };
  await client.listeners('interactionCreate')[0](listInteraction);
  assert.equal(replies[0].deferred.ephemeral, true);
  assert.match(replies[1].list.content, /私密清單/);
  assert.doesNotMatch(JSON.stringify(replies[1].list), /thread-1/);
  assert.doesNotMatch(JSON.stringify(replies[1].list), privatePathPattern);
  const menuToken = replies[1].list.components[0].toJSON().components[0].options[0].value;
  const selectInteraction = { ...common, customId: 'codex:history:preview', values: [menuToken],
    isStringSelectMenu: () => true, update: async payload => { replies.push({ preview: payload }); } };
  await client.listeners('interactionCreate')[0](selectInteraction);
  const preview = replies.at(-1).preview;
  assert.match(preview.content, /URL 已隱藏/);
  assert.match(preview.content, /憑證已隱藏/);
  assert.doesNotMatch(preview.content, /private\.invalid|abc\.def|do not show/);
  const continueInteraction = { ...common,
    options: { getSubcommandGroup: () => null, getSubcommand: () => 'continue',
      getString: name => name === 'workspace' ? 'workspace' : null },
    deferred: false, deferReply: async function (payload) { this.deferred = true; replies.push({ continueDeferred: payload }); },
    editReply: async payload => { replies.push({ continueList: payload }); } };
  await client.listeners('interactionCreate')[0](continueInteraction);
  const continueList = replies.at(-1).continueList;
  assert.match(continueList.content, /可延續對話/);
  const continueToken = continueList.components[0].toJSON().components[0].options[0].value;
  const continueSelect = { ...common, customId: 'codex:continue:select', values: [continueToken],
    isStringSelectMenu: () => true, update: async payload => { replies.push({ continuePreview: payload }); } };
  await client.listeners('interactionCreate')[0](continueSelect);
  assert.match(replies.at(-1).continuePreview.content, /Goal：狀態未知/);
  assert.ok(replies.at(-1).continuePreview.components[0].toJSON().components
    .some(button => button.custom_id === `codex:continue:chat:${continueToken}`));
  const pageInteraction = { ...common, customId: `codex:history:page:${'P'.repeat(32)}`,
    isButton: () => true, update: async payload => { replies.push({ nextPage: payload }); } };
  await client.listeners('interactionCreate')[0](pageInteraction);
  assert.equal(calls.cursorWorkspace, 'workspace');
  assert.equal(calls.listed, 3);
  assert.equal(calls.listParams[2].cursor, 'page-2');
  assert.ok(replies.at(-1).nextPage.allowedMentions.parse.length === 0);
  assert.equal(calls.execute, 0);
  assert.equal(calls.closed, 5);
});
