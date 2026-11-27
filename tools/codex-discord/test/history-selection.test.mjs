import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startBot } from '../src/bot.mjs';
import { sessionKey, SessionStore } from '../src/session-store.mjs';

test('selecting a preview persists a pending fork binding without executing Codex', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'codex-discord-history-selection-'));
  try {
    const client = new EventEmitter();
    client.login = async () => {};
    const sessions = new SessionStore(stateDir);
    await sessions.load();
    let executeCalls = 0, clientCloses = 0, goalStateReads = 0, executionArgs = null;
    let sourceGoal = null, forkGoal = null, sourceUpdatedAt = 10;
    const runner = { isRunning: () => false, execute: async args => {
      executeCalls++;
      executionArgs = args;
      await args.onBeforeFork(args.forkFrom);
      const forkThreadId = executeCalls === 1 ? 'fork-thread' : `fork-thread-${executeCalls}`;
      await args.onSessionId(forkThreadId);
      if (args.goalRun?.resume) forkGoal = { ...sourceGoal, threadId: forkThreadId, updatedAt: '2026-10-25T00:02:00Z' };
      else forkGoal = null;
      await args.onForkPrepared(forkThreadId);
      if (args.goalRun?.resume) forkGoal = { ...forkGoal, status: 'complete' };
      return { sessionId: forkThreadId, exitCode: 0, message: 'completed', checkpointMutable: true };
    }, getUsage: async () => null };
    const config = { botToken: 'test', guildId: 'guild', historyEnabled: true, goalsEnabled: true,
      allowedUserIds: new Set(['12345678901234567']), allowedChannelIds: new Set(['22345678901234567']),
      workspaces: new Map([['workspace', { path: '/work' }]]) };
    const historyAccess = {
      authorizeContext: async () => ({ workspacePath: '/work' }),
      assertThreadReadable: async (_context, metadata) => ({ threadId: metadata.id }),
      filterThreads: async (_context, threads) => threads,
      issueCandidate: async () => ({ token: 'C'.repeat(32) }), issueCursor: async () => null,
      resolveCandidate: async (_context, { token, query, readMetadata }) => {
        assert.equal(token, 'C'.repeat(32)); assert.equal(query, '');
        const metadata = await readMetadata({ threadId: 'native-thread', cwd: '/work', sourceKinds: ['vscode'] });
        return { threadId: metadata.id, source: metadata.source };
      }
    };
    const historyClientFactory = async () => ({
      listThreads: async () => ({ data: [{ id: 'native-thread', title: 'Source', source: 'vscode', cwd: '/work', updatedAt: 10 }], nextCursor: null }),
      readThread: async () => ({ thread: { id: 'native-thread', title: 'Source', source: 'vscode', cwd: '/work', updatedAt: sourceUpdatedAt } }),
      listTurns: async () => ({ data: [{ id: 'anchor-turn', status: 'completed', completedAt: 10 }], nextCursor: null }),
      listItems: async () => ({ data: [{ turnId: 'anchor-turn', item: { type: 'userMessage', content: [{ type: 'text', text: 'Private preview text' }] } }], nextCursor: null }),
      close: async () => { clientCloses++; }
    });
    await startBot({ clientFactory: () => client, runner, sessions, config, historyAccess, historyClientFactory,
      goalClientFactory: async () => ({ getGoal: async ({ threadId }) => {
        goalStateReads++;
        return { goal: threadId === 'native-thread' ? sourceGoal
          : threadId.startsWith('fork-thread') ? forkGoal : null };
      }, setGoal: async () => {}, clearGoal: async () => {}, close: async () => {} }) });
    const base = { user: { id: '12345678901234567' }, guildId: 'guild', channelId: '22345678901234567',
      channel: {}, commandName: 'codex', isButton: () => false, isModalSubmit: () => false,
      isAutocomplete: () => false, isChatInputCommand: () => true };
    const list = { ...base, options: { getSubcommandGroup: () => 'sessions', getSubcommand: () => 'list',
      getString: name => ({ workspace: 'workspace', query: '', source: 'all' })[name] }, deferred: false,
    deferReply: async function () { this.deferred = true; }, editReply: async function (payload) { this.listPayload = payload; } };
    await client.listeners('interactionCreate')[0](list);
    const listMenuToken = list.listPayload.components[0].toJSON().components[0].options[0].value;
    const preview = { ...base, customId: 'codex:history:preview', values: [listMenuToken],
      isStringSelectMenu: () => true, update: async function (payload) { this.payload = payload; } };
    await client.listeners('interactionCreate')[0](preview);
    assert.match(preview.payload.content, /Private preview text/);
    const selectButton = preview.payload.components[0].toJSON().components
      .find(component => component.custom_id.startsWith('codex:history:select:'));
    assert.ok(selectButton);
    const select = { ...base, customId: selectButton.custom_id, isButton: () => true,
      update: async function (payload) { this.payload = payload; } };
    await client.listeners('interactionCreate')[0](select);
    assert.match(select.payload.content, /待 fork/);
    assert.doesNotMatch(select.payload.content, /Private preview text|native-thread|anchor-turn/);
    assert.equal(select.payload.allowedMentions.parse.length, 0);
    const key = sessionKey({ userId: base.user.id, channelId: base.channelId, workspace: 'workspace' });
    const binding = sessions.get(key);
    assert.equal(binding.sessionId, null);
    assert.equal(binding.sourceThreadId, 'native-thread');
    assert.equal(binding.sourceLastCompletedTurnId, 'anchor-turn');
    assert.equal(binding.sourceUpdatedAt, 10);
    assert.equal(binding.selectionMode, 'fork');
    assert.equal(binding.selectionRevision, 1);
    assert.equal(executeCalls, 0);
    assert.equal(clientCloses, 3);

    const current = { ...base, options: { getSubcommandGroup: () => 'sessions', getSubcommand: () => 'current',
      getString: name => name === 'workspace' ? 'workspace' : null },
    reply: async function (payload) { this.payload = payload; } };
    await client.listeners('interactionCreate')[0](current);
    assert.match(current.payload.content, /待安全 fork/);
    assert.equal(current.payload.ephemeral, true);

    const makeGoalStart = () => ({ ...base, options: { getSubcommandGroup: () => 'goal', getSubcommand: () => 'start',
      getString: (name, required) => name === 'workspace' || required ? (name === 'workspace' ? 'workspace' : 'Build the selected task') : null,
      getInteger: () => null }, deferred: false,
      deferReply: async function () { this.deferred = true; },
      editReply: async function (payload) { this.goalPayload = payload; return { id: 'goal-status',
        edit: async value => { this.goalFinal = value; }, channel: { send: async () => {} } }; } });
    const unconfirmedGoal = makeGoalStart();
    await client.listeners('interactionCreate')[0](unconfirmedGoal);
    assert.match(unconfirmedGoal.goalPayload.content, /先在歷史預覽確認/);
    assert.equal(executeCalls, 0, 'Goal start requires the one-shot handoff grant');

    const refusedHandoff = { ...base, options: { getSubcommandGroup: () => 'sessions', getSubcommand: () => 'handoff',
      getString: () => 'workspace', getBoolean: () => false },
    deferReply: async function () { this.deferred = true; },
    editReply: async function (payload) { this.payload = payload; } };
    const closesBeforeRefusal = clientCloses;
    await client.listeners('interactionCreate')[0](refusedHandoff);
    assert.match(refusedHandoff.payload.content, /尚未確認來源工作已停止/);
    assert.equal(clientCloses, closesBeforeRefusal, 'declining the handoff performs no source read or mutation');

    const statusEdits = [], messageReplies = [];
    const message = { author: base.user, bot: false, guildId: base.guildId, channelId: base.channelId,
      channel: {}, content: 'Continue this conversation', attachments: { size: 0, values: function* () {} },
      reply: async payload => { messageReplies.push(payload); return { id: 'pending-status',
        edit: async value => statusEdits.push(value), channel: { send: async () => {} } }; } };
    await client.listeners('messageCreate')[0](message);
    assert.equal(executeCalls, 0, 'pending selection must not become a new empty conversation');
    assert.match(JSON.stringify(messageReplies), /待交接確認/);

    const handoffButton = select.payload.components[0].toJSON().components
      .find(component => component.custom_id.startsWith('codex:history:handoff:'));
    assert.ok(handoffButton);
    const confirmHandoff = { ...base, customId: handoffButton.custom_id, isButton: () => true,
      update: async function (payload) { this.payload = payload; } };
    await client.listeners('interactionCreate')[0](confirmHandoff);
    assert.match(confirmHandoff.payload.content, /交接確認完成/);
    assert.match(confirmHandoff.payload.content, /`\/codex goal resume`/);
    assert.equal(clientCloses, 4);
    assert.equal(executeCalls, 0, 'handoff confirmation itself must not execute Codex');

    const confirmedGoalInteraction = makeGoalStart();
    await client.listeners('interactionCreate')[0](confirmedGoalInteraction);
    assert.equal(executeCalls, 1, 'confirmed pending selection starts a native Goal on a controlled fork');
    assert.deepEqual(executionArgs.forkFrom, { threadId: 'native-thread', lastTurnId: 'anchor-turn' });
    assert.equal(executionArgs.goalRun.objective, 'Build the selected task');
    assert.equal(executionArgs.prepareForkGoal, false);
    assert.ok(goalStateReads >= 3, 'source Goal is checked before execution and again immediately before fork');
    assert.equal(clientCloses, 5);
    assert.equal(sessions.get(key).origin, 'native-fork');
    assert.equal(sessions.get(key).sessionId, 'fork-thread');
    assert.equal(sessions.get(key).sourceUpdatedAt, 10);

    sourceGoal = { threadId: 'native-thread', objective: 'Continue the selected Goal', status: 'paused',
      tokenBudget: 900, tokensUsed: 240, timeUsedSeconds: 18, createdAt: '2026-10-25T00:00:00Z',
      updatedAt: '2026-10-25T00:01:00Z' };
    const relist = { ...base, options: { getSubcommandGroup: () => 'sessions', getSubcommand: () => 'list',
      getString: name => ({ workspace: 'workspace', query: '', source: 'all' })[name] }, deferred: false,
      deferReply: async function () { this.deferred = true; }, editReply: async function (payload) { this.listPayload = payload; } };
    await client.listeners('interactionCreate')[0](relist);
    assert.match(relist.listPayload.content, /Goal：paused/,
      'history list should reveal that the selected source has a paused Goal before preview');
    const resumeMenuToken = relist.listPayload.components[0].toJSON().components[0].options[0].value;
    const resumePreview = { ...base, customId: 'codex:history:preview', values: [resumeMenuToken],
      isStringSelectMenu: () => true, update: async function (payload) { this.payload = payload; } };
    await client.listeners('interactionCreate')[0](resumePreview);
    const resumeSelectId = resumePreview.payload.components[0].toJSON().components
      .find(component => component.custom_id.startsWith('codex:history:select:')).custom_id;
    const selectAgain = { ...base, customId: resumeSelectId, isButton: () => true,
      update: async function (payload) { this.payload = payload; } };
    await client.listeners('interactionCreate')[0](selectAgain);
    const resumeHandoffId = selectAgain.payload.components[0].toJSON().components
      .find(component => component.custom_id.startsWith('codex:history:handoff:')).custom_id;
    assert.ok(resumeHandoffId, 'selection still exposes the button handoff path');
    const runHandoffCommand = async () => {
      const interaction = { ...base, options: { getSubcommandGroup: () => 'sessions', getSubcommand: () => 'handoff',
        getString: () => 'workspace', getBoolean: () => true },
      deferReply: async function () { this.deferred = true; },
      editReply: async function (payload) { this.payload = payload; } };
      await client.listeners('interactionCreate')[0](interaction);
      return interaction;
    };
    sourceUpdatedAt = 11;
    const staleHandoff = await runHandoffCommand();
    assert.match(staleHandoff.payload.content, /來源對話在預覽後已有更新/);
    assert.doesNotMatch(staleHandoff.payload.content, /交接確認完成/);
    sourceUpdatedAt = 10;
    const confirmResumeHandoff = await runHandoffCommand();
    assert.match(confirmResumeHandoff.payload.content, /交接確認完成/);
    assert.match(confirmResumeHandoff.payload.content, /`\/codex goal resume`/);
    const resumeInteraction = { ...base, options: { getSubcommandGroup: () => 'goal', getSubcommand: () => 'resume',
      getString: () => 'workspace', getInteger: () => null }, deferred: false,
      deferReply: async function () { this.deferred = true; },
      editReply: async function (payload) { this.goalPayload = payload; return { id: 'goal-resume-status',
        edit: async value => { this.goalFinal = value; }, channel: { send: async () => {} } }; } };
    await client.listeners('interactionCreate')[0](resumeInteraction);
    assert.equal(executeCalls, 2);
    assert.deepEqual(executionArgs.forkFrom, { threadId: 'native-thread', lastTurnId: 'anchor-turn' });
    assert.equal(executionArgs.goalRun.resume, true);
    assert.equal(executionArgs.goalRun.objective, sourceGoal.objective);
    assert.equal(executionArgs.goalRun.expectedRevision, undefined, 'source revision must not be applied to fork target');
    assert.equal(sessions.get(key).sessionId, 'fork-thread-2');
    assert.equal(sessions.get(key).forkGoalPrepared, true);
    assert.ok(goalStateReads >= 8, 'source and fork target Goal state are verified around the fork');

    await sessions.delete(key);
    const oldPreview = { ...base, options: { getSubcommandGroup: () => 'sessions', getSubcommand: () => 'preview',
      getString: name => ({ workspace: 'workspace', thread: listMenuToken, query: '' })[name] }, deferred: false,
    deferReply: async function () { this.deferred = true; }, editReply: async function (payload) { this.payload = payload; } };
    await client.listeners('interactionCreate')[0](oldPreview);
    const oldSelectId = oldPreview.payload.components[0].toJSON().components
      .find(component => component.custom_id.startsWith('codex:history:select:')).custom_id;
    const staleSelect = { ...base, customId: oldSelectId, isButton: () => true, replied: false,
      reply: async function (payload) { this.payload = payload; } };
    await client.listeners('interactionCreate')[0](staleSelect);
    assert.match(staleSelect.payload.content, /Session binding changed|workspace since the history list was loaded/);
    assert.equal(sessions.get(key), null, 'an old candidate cannot overwrite a reset or newer binding');
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

test('new Discord threads are ownership-claimed before session state even when history is disabled', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'codex-discord-owned-runtime-'));
  try {
    const client = new EventEmitter();
    client.login = async () => {};
    const sessions = new SessionStore(stateDir);
    await sessions.load();
    const claims = [];
    const ownership = { claim: async value => { claims.push(value); } };
    let executionArgs;
    const runner = { isRunning: () => false, getUsage: async () => null,
      execute: async args => { executionArgs = args; await args.onSessionId('new-discord-thread');
        return { sessionId: 'new-discord-thread', exitCode: 0, message: 'completed', checkpointMutable: true }; } };
    const config = { botToken: 'test', guildId: 'guild', allowedUserIds: new Set(['12345678901234567']),
      allowedChannelIds: new Set(['22345678901234567']), workspaces: new Map([['workspace', { path: stateDir }]]) };
    await startBot({ clientFactory: () => client, runner, sessions, ownership, config });
    const interaction = { user: { id: '12345678901234567' }, guildId: 'guild', channelId: '22345678901234567',
      channel: {}, commandName: 'codex', deferred: false, replied: false,
      isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
      options: { getSubcommandGroup: () => null, getSubcommand: () => 'run',
        getString: name => ({ workspace: 'workspace', task: 'write a test' })[name], getAttachment: () => null },
      deferReply: async function () { this.deferred = true; },
      editReply: async function (payload) {
        if (payload) this.statusPayload = payload;
        return { id: 'status-message', edit: async value => { this.finalPayload = value; }, channel: { send: async () => {} } };
      } };
    await client.listeners('interactionCreate')[0](interaction);
    assert.equal(claims.length, 1);
    assert.deepEqual(claims[0], { threadId: 'new-discord-thread', ownerUserId: interaction.user.id, provenance: 'discord-runtime' });
    assert.equal(sessions.get(sessionKey({ userId: interaction.user.id, channelId: interaction.channelId,
      workspace: 'workspace' })).sessionId, 'new-discord-thread');
    assert.ok(executionArgs);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});
