import test from "node:test";
import assert from "node:assert/strict";
import { applyUsagePresence, approvalComponents, commandDefinition, createProgressReporter, formatQuestionResult, formatUsageResult, imageUrlsForAttachments, isReplyToActiveStatus, modelAutocompleteChoices, persistUsageCheckpoint, reasoningAutocompleteChoices, resolveWorkspaceName, safeStatusChunks, statusChunks, usagePresenceText, workspaceAutocompleteChoices } from "../src/bot.mjs";
import { formatGoalCommandError, GOAL_COMMAND_ACTIONS } from '../src/goal-command.mjs';

test('Goal activity reporter keeps only a short cleaned objective and bounded native status fields', async () => {
  const payloads = [];
  const reporter = createProgressReporter({ workspaceName: 'workspace', task: 'ignored general prompt',
    model: null, reasoningEffort: null, progressLines: 0, edit: async payload => payloads.push(payload) });
  await reporter.updateGoalActivity({ objective: 'Open https://private.example/path using api_key=secret', status: 'active',
    turnsSeen: 2, turnsCompleted: 1, turnInFlight: true, tokensUsed: 310, tokenBudget: 1200 }, []);
  reporter.update({ method: 'item/started', params: { item: { type: 'commandExecution',
    command: 'cat /tmp/private/secret.txt', aggregatedOutput: 'private command output' } } });
  await reporter.finish();
  const final = payloads.at(-1);
  assert.match(final.content, /原生 Goal 活動/);
  assert.match(final.content, /目標：敏感內容已隱藏/);
  assert.match(final.content, /狀態：active/);
  assert.match(final.content, /目前回合：第 2 輪執行中/);
  assert.match(final.content, /用量：310 \/ 1200 tokens/);
  assert.doesNotMatch(final.content, /private\.example|api_key|secret\.txt|private command output|ignored general prompt/);
  assert.deepEqual(final.components, []);
});

test('Goal activity objective hides common opaque credential formats without labels', async () => {
  const ghPrefix = ['gh', 'p_'].join('');
  const openAiPrefix = ['sk', '-proj-'].join('');
  const jwtPrefix = ['ey', 'J'].join('');
  const cases = [
    { objective: `Continue using ${ghPrefix}1234567890abcdefghijklmnopqrstuv123456`, marker: ghPrefix },
    { objective: `Deploy with ${openAiPrefix}1234567890abcdefghijklmnopqrstuvwx`, marker: openAiPrefix },
    { objective: `Use ${jwtPrefix}abcdefghijklmno.12345678901234567890.abcdefghijklmnop`, marker: jwtPrefix }
  ];
  for (const { objective, marker } of cases) {
    const payloads = [];
    const reporter = createProgressReporter({ workspaceName: 'workspace', task: 'ignored', model: null,
      reasoningEffort: null, progressLines: 0, edit: async payload => payloads.push(payload) });
    await reporter.updateGoalActivity({ objective, status: 'active', turnsSeen: 1,
      turnInFlight: false, tokensUsed: 0, tokenBudget: 100 }, []);
    await reporter.finish();
    assert.match(payloads.at(-1).content, /目標：敏感內容已隱藏/);
    assert.doesNotMatch(payloads.at(-1).content, new RegExp(marker));
  }
});

test('final delivery formats tables and preserves confirmed attachments and mention suppression', async () => {
  const payloads = [];
  const status = { edit: async payload => payloads.push(payload),
    channel: { send: async payload => {
      payloads.push(payload);
      if (!payload.files) return;
      return { attachments: new Map([['1', { id: '1', name: 'result.jar', size: 5,
        url: 'https://cdn.discordapp.com/attachments/test/result.jar' }]]) };
    } } };
  await statusChunks(status, '| Profile | FPS |\n| --- | --- |\n| RGB | 300 |\n\n```js\n'
    + '    sample();\n'.repeat(400) + '```\n[result](/tmp/result.jar)',
    [{ attachment: '/tmp/result.jar', name: 'result.jar' }]);
  const attachmentMessage = payloads.find(payload => payload.files);
  assert.ok(attachmentMessage, 'attachments are sent as their own Discord message');
  assert.match(attachmentMessage.content, /Codex 附件：result.jar/);
  assert.equal(payloads.filter(payload => payload.files).length, 1);
  assert.ok(payloads.filter(payload => !payload.files).some(payload => /附件已另行傳送並由 Discord 確認/.test(payload.content)));
  assert.ok(payloads.some(payload => /- Profile：RGB\n  - FPS：300/.test(payload.content)));
  for (const payload of payloads) {
    assert.ok(payload.content.length <= 1850);
    assert.equal((payload.content.match(/```/g) ?? []).length % 2, 0);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    assert.ok(!payload.content.includes('/tmp/'));
  }
});

test('usage summary distinguishes observed tools and requested effort from model turns', () => {
  const text = formatQuestionResult('bounded task', { exitCode: 0, message: 'done', usageSummary: {
    observedToolCalls: 2, firstContext: 100, peakContext: 200, threadInputTokens: 300,
    threadOutputTokens: 10, reportedModel: null, requestedEffort: 'medium'
  } });
  assert.match(text, /工具 2 次/);
  assert.match(text, /回報模型 未知/);
  assert.match(text, /要求 effort medium/);
  assert.match(text, /非逐輪分佈/);
  assert.match(text, /本輪 context/);
  assert.match(text, /整段對話累計 input\/output/);
});

test('privacy-safe telemetry distinguishes unknown counters, estimates and observed compaction', () => {
  const text = formatQuestionResult('bounded task', { exitCode: 0, message: 'done', telemetry: {
    tokens: { inputTokens: 120, cachedInputTokens: 80, cacheWriteInputTokens: null,
      outputTokens: 4, reasoningOutputTokens: null },
    boundedContext: { bytes: 640, estimatedTokens: 160, tokenCountKind: 'estimated-from-utf8-bytes' },
    compaction: { status: 'observed', observedCount: 1, evidence: 'runtime-event' }
  } });
  assert.match(text, /input 120/);
  assert.match(text, /cache-write \?/);
  assert.match(text, /bounded context 640 bytes（估算 160 tokens）/);
  assert.match(text, /compaction 已觀察 1 次/);
});

test('local context stops explain the limit and preserve-history recovery separately from account quota', async () => {
  const summary = { observedToolCalls: 0, firstContext: 190219, peakContext: 190219,
    stopReason: 'context-limit', maxContextTokens: 64000, stopped: true };
  const text = formatQuestionResult('Inspect progress', { exitCode: 1, message: 'Stopped', usageSummary: summary });
  assert.match(text, /64000 tokens/);
  assert.match(text, /並非帳戶配額耗盡/);
  assert.match(text, /原始歷史仍保留/);
  const edits = [];
  const progress = createProgressReporter({ workspaceName: 'workspace', task: 'Inspect', edit: async payload => edits.push(payload) });
  progress.update({ method: 'bridge/usageGuard', params: { action: 'stop', ...summary } });
  const retained = await progress.finish();
  assert.match(JSON.stringify({ edits, retained }), /本輪 context 已達本機 64000/);
});

test('usage checkpoint persistence receives only bounded runtime and repository metadata', async () => {
  const writes = [];
  const saved = await persistUsageCheckpoint({
    sessions: { setCheckpoint: async (key, value) => { writes.push({ key, value }); return true; } },
    key: 'user:channel:workspace', workspaceName: 'workspace', workspacePath: '/unused',
    repositoryState: { branch: 'feature/test', head: 'a'.repeat(40), filesChanged: ['src/A.mjs'] },
    event: { method: 'bridge/usageGuard', params: { action: 'checkpoint', threadId: 'thread-1',
      turnId: 'turn-1', observedToolCalls: 40, peakContext: 48000, prompt: 'private prompt' } }
  });
  assert.equal(saved, true);
  assert.equal(writes[0].value.id, 'thread-1:turn-1');
  assert.deepEqual(writes[0].value.filesChanged, ['src/A.mjs']);
  assert.equal(writes[0].value.usage.peakContext, 48000);
  assert.ok(!Object.hasOwn(writes[0].value, 'prompt'));
  assert.equal(await persistUsageCheckpoint({ sessions: { setCheckpoint: async () => true }, key: 'key',
    workspaceName: 'workspace', workspacePath: '/unused', event: { method: 'bridge/usageGuard',
      params: { action: 'stop', threadId: 'thread-1', turnId: 'turn-1' } },
    repositoryState: { branch: null, head: null, filesChanged: [] } }), true);
  assert.equal(await persistUsageCheckpoint({ sessions: { setCheckpoint: async () => true }, key: 'key',
    workspaceName: 'workspace', workspacePath: '/unused', event: { method: 'bridge/usageGuard',
      params: { action: 'checkpoint', checkpointMutable: false, threadId: 'thread-1', turnId: 'turn-2' } },
    repositoryState: { branch: null, head: null, filesChanged: [] } }), false);
});

test("progress cards show sanitized CLI-style activity as Discord subtext", async () => {
  const edits = [];
  const progress = createProgressReporter({
    workspaceName: "workspace",
    task: "請檢查目前的測試是否可執行",
    model: null,
    edit: async (payload) => edits.push(payload)
  });

  progress.update({ method: "item/reasoning/summaryTextDelta", params: { itemId: "reasoning-1", delta: "先確認測試與目前設定。" } });
  progress.update({ method: "item/reasoning/textDelta", params: { itemId: "reasoning-1", delta: "NEVER_SHOW_RAW_REASONING" } });
  progress.update({ method: "item/started", params: { item: { id: "test-1", type: "commandExecution", command: "npm test", status: "inProgress" } } });
  progress.update({ method: "item/commandExecution/outputDelta", params: { itemId: "test-1", delta: "NEVER_SHOW_RAW_OUTPUT" } });
  progress.update({ method: "item/completed", params: { item: { id: "test-1", type: "commandExecution", command: "npm test", status: "completed", exitCode: 0, durationMs: 1_250 } } });
  progress.update({ method: "item/started", params: { item: { id: "patch-1", type: "fileChange", changes: [{ path: "src/bot.mjs" }] } } });
  progress.update({ method: "item/started", params: { item: { id: "secret-1", type: "commandExecution", command: "curl -H 'Authorization: super-secret' https://example.com" } } });

  await progress.requestApproval({ requestId: "approval-1", kind: "file-change" }, []);
  const approvalContent = edits.at(-1).content;
  assert.match(approvalContent, /問題／需求/);
  assert.match(approvalContent, /需要你的授權才能繼續/);
  assert.doesNotMatch(approvalContent, /-# /);

  await progress.approvalSubmitted();
  const content = edits.at(-1).content;
  assert.match(content, /-# 思考：先確認測試與目前設定。/);
  assert.match(content, /-# 完成：`npm test` · exit 0 · 1.3s/);
  assert.match(content, /-# 修改檔案：src\/bot\.mjs/);
  assert.match(content, /-# 執行：本機指令（敏感內容已隱藏）/);
  assert.doesNotMatch(content, /NEVER_SHOW_RAW_REASONING|NEVER_SHOW_RAW_OUTPUT|super-secret/);

  const retainedProgress = await progress.finish();
  const final = formatQuestionResult(
    "請檢查目前的測試是否可執行",
    { exitCode: 0, message: "測試已完成。" },
    retainedProgress
  );
  assert.match(final, /問題／需求/);
  assert.match(final, /Codex 回覆/);
  assert.match(final, /測試已完成/);
  assert.match(final, /-# 思考：先確認測試與目前設定。/);
  assert.doesNotMatch(final, /npm test|本機指令|exit 0|src\/bot\.mjs|修改檔案/);
  assert.ok(final.indexOf("-# 思考：") < final.indexOf("**Codex 回覆**"));
});

test("file and current subagent activity stays live but is omitted from final progress", async () => {
  const edits = [];
  const progress = createProgressReporter({
    workspaceName: "workspace",
    task: "修改程式並補測試",
    model: "gpt-5.6-sol",
    progressLines: 3,
    edit: async (payload) => edits.push(payload)
  });

  progress.update({
    method: "item/completed",
    params: {
      item: {
        id: "agent-1",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        status: "completed",
        model: "gpt-5.3-codex-spark"
      }
    }
  });
  progress.update({
    method: "item/started",
    params: {
      item: {
        id: "subagent-activity-1",
        type: "subAgentActivity",
        kind: "interacted"
      }
    }
  });
  progress.update({
    method: "item/completed",
    params: {
      item: {
        id: "newer-subagent-activity-1",
        type: "collabToolCall",
        tool: "wait",
        model: "gpt-5.3-codex-spark"
      }
    }
  });
  const retainedProgress = await progress.finish();

  assert.match(edits.at(-1).content, /已啟動程式 subagent：gpt-5\.3-codex-spark/);
  assert.match(edits.at(-1).content, /程式 subagent 正在回覆協調訊息/);
  assert.match(edits.at(-1).content, /程式 subagent 工作完成/);
  assert.deepEqual(retainedProgress, []);
});

test("only a task owner can reply to that task's persistent status card", () => {
  const activeTask = {
    statusMessageId: "status-1",
    userId: "user-1",
    channelId: "channel-1"
  };
  assert.equal(isReplyToActiveStatus({
    reference: { messageId: "status-1" },
    author: { id: "user-1" },
    channelId: "channel-1"
  }, activeTask), true);
  assert.equal(isReplyToActiveStatus({
    reference: { messageId: "status-1" },
    author: { id: "other-user" },
    channelId: "channel-1"
  }, activeTask), false);
  assert.equal(isReplyToActiveStatus({
    reference: { messageId: "another-message" },
    author: { id: "user-1" },
    channelId: "channel-1"
  }, activeTask), false);
  assert.equal(isReplyToActiveStatus({
    reference: { message_id: "status-1" },
    author: { id: "user-1" },
    channelId: "other-channel"
  }, activeTask), false);
});

test("approval cards offer task-scoped automatic approval", async () => {
  const [row] = approvalComponents("approval-token", {
    kind: "command",
    availableDecisions: ["accept", "acceptForSession", "decline"]
  });
  const buttons = row.toJSON().components;

  assert.ok(buttons.some((button) => button.custom_id === "codex:approval:approval-token:allow-all"
    && button.label === "本次工作全部允許"));
  assert.ok(buttons.some((button) => button.custom_id === "codex:approval:approval-token:decline"));
});

test("the progress command accepts zero through eight gray activity lines", () => {
  const command = commandDefinition(["workspace"]).toJSON();
  const progress = command.options.find((option) => option.name === "progress");
  const lines = progress.options.find((option) => option.name === "lines");

  assert.equal(lines.required, true);
  assert.equal(lines.min_value, 0);
  assert.equal(lines.max_value, 8);
});

test('continue is a root command with an optional workspace selector', () => {
  const command = commandDefinition(['workspace']).toJSON();
  const continuation = command.options.find(option => option.name === 'continue');
  assert.equal(continuation.type, 1);
  assert.equal(continuation.options[0].name, 'workspace');
  assert.equal(continuation.options[0].required, false);
});

test('the sessions command exposes private list and preview actions', () => {
  const command = commandDefinition(["workspace"]).toJSON();
  const sessions = command.options.find(option => option.name === 'sessions');
  assert.equal(sessions.type, 2);
  assert.deepEqual(sessions.options.map(option => option.name), ['list', 'preview', 'current', 'handoff']);
  assert.ok(sessions.options.every(subcommand => subcommand.options.find(option => option.name === 'workspace').required === false));
  assert.ok(sessions.options[0].options.some(option => option.name === 'source'));
  assert.ok(sessions.options[1].options.some(option => option.name === 'thread'));
});

test('workspace resolves from the session thread and asks only when bindings are ambiguous', () => {
  const bindings = new Map([['owner:thread:totem-core', { sessionId: 'codex-thread' }]]);
  let activeWorkspace = 'workspace';
  const sessions = { get: key => bindings.get(key) ?? null,
    activeWorkspace: key => key === 'owner:parent' ? 'totem-core' : activeWorkspace };
  const base = { userId: 'owner', channelId: 'thread', sessions,
    workspaceNames: ['workspace', 'totem-core'] };
  assert.equal(resolveWorkspaceName(base), 'totem-core');
  assert.equal(resolveWorkspaceName({ ...base, explicit: 'workspace' }), 'workspace');
  bindings.set('owner:thread:workspace', { sessionId: 'other-thread' });
  assert.equal(resolveWorkspaceName(base), 'workspace', 'an active workspace disambiguates multiple legacy bindings');
  activeWorkspace = null;
  assert.equal(resolveWorkspaceName(base), null);
  bindings.delete('owner:thread:workspace');
  activeWorkspace = 'workspace';
  assert.equal(resolveWorkspaceName({ ...base, channelId: 'parent' }), 'totem-core');
  activeWorkspace = null;
  assert.equal(resolveWorkspaceName({ ...base, parentChannelId: 'parent' }), 'totem-core',
    'an unbound thread inherits the parent channel workspace');

  const command = commandDefinition(['workspace', 'totem-core']).toJSON();
  const run = command.options.find(option => option.name === 'run');
  assert.equal(run.options.find(option => option.name === 'workspace').required, false);
  const use = command.options.find(option => option.name === 'use');
  assert.equal(use.options.find(option => option.name === 'workspace').required, true);
});

test('Discord command schemas place required options before optional workspace options', () => {
  const command = commandDefinition(['workspace', 'totem-core']).toJSON();
  const checkOptions = (options, commandPath) => {
    let optionalSeen = false;
    for (const option of options ?? []) {
      const path = `${commandPath}/${option.name}`;
      if (option.type === 1 || option.type === 2) {
        for (const child of option.options ?? []) {
          if (option.type === 1) continue;
          checkOptions(child.options, `${path}/${child.name}`);
        }
        if (option.type === 1) checkOptions(option.options, path);
        continue;
      }
      if (!option.required) optionalSeen = true;
      else assert.equal(optionalSeen, false, `${path} is required after an optional option`);
    }
  };
  checkOptions(command.options, '/codex');
});

test('workspace selectors use bounded allowlist autocomplete and keep command registration below Discord size limits', () => {
  const workspaces = ['workspace', 'totem-core', 'totem-workspace', 'codex-discord'];
  assert.deepEqual(workspaceAutocompleteChoices(workspaces, 'totem'), [
    { name: 'totem-core', value: 'totem-core' },
    { name: 'totem-workspace', value: 'totem-workspace' }
  ]);
  assert.equal(workspaceAutocompleteChoices(Array.from({ length: 40 }, (_, index) => `repo-${index}`)).length, 25);
  const command = commandDefinition(workspaces).toJSON();
  const run = command.options.find(option => option.name === 'run');
  const workspace = run.options.find(option => option.name === 'workspace');
  assert.equal(workspace.autocomplete, true);
  assert.equal(workspace.choices, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(command), 'utf8') < 8_000);
});

test('the native Goal command schema exposes only the planned bounded actions', () => {
  const command = commandDefinition(['workspace']).toJSON();
  const goal = command.options.find(option => option.name === 'goal');
  assert.equal(goal.type, 2);
  assert.deepEqual(goal.options.map(option => option.name), ['start', 'status', 'pause', 'resume', 'budget', 'clear']);
  assert.deepEqual(goal.options.map(option => option.name), GOAL_COMMAND_ACTIONS);
  const start = goal.options.find(option => option.name === 'start');
  const objective = start.options.find(option => option.name === 'objective');
  const startBudget = start.options.find(option => option.name === 'token_budget');
  assert.equal(objective.required, true);
  assert.equal(objective.max_length, 4_000);
  assert.equal(startBudget.required, false);
  assert.equal(startBudget.min_value, 1);
  const budget = goal.options.find(option => option.name === 'budget')
    .options.find(option => option.name === 'token_budget');
  assert.equal(budget.required, true);
  assert.equal(budget.min_value, 1);
});

test('Goal runtime error mapping is bounded and does not leak unknown RPC details', () => {
  assert.match(formatGoalCommandError({ code: 'GOAL_REVISION_CONFLICT' }), /狀態已改變/);
  assert.match(formatGoalCommandError({ code: 'GOAL_STATE_INVALID', message: 'private RPC body' }), /無法確認/);
  assert.doesNotMatch(formatGoalCommandError({ code: 'UNKNOWN', message: 'private RPC body' }), /private RPC body/);
});

test("progress cards show the configured command tail without retaining commands for the final reply", async () => {
  const edits = [];
  const progress = createProgressReporter({
    workspaceName: "workspace",
    task: "Run three checks",
    model: null,
    progressLines: 2,
    edit: async (payload) => edits.push(payload)
  });
  for (const [id, command] of [["one", "first-check"], ["two", "second-check"], ["three", "third-check"]]) {
    progress.update({ method: "item/started", params: { item: { id, type: "commandExecution", command } } });
  }

  const retainedProgress = await progress.finish();

  const content = edits.at(-1).content;
  assert.doesNotMatch(content, /first-check/);
  assert.match(content, /-# 執行：`second-check`/);
  assert.match(content, /-# 執行：`third-check`/);
  assert.equal((content.match(/^-# /gm) ?? []).length, 2);
  assert.deepEqual(retainedProgress, []);
});

test("streamed gray progress keeps the complete sentence without character truncation", async () => {
  const edits = [];
  const progress = createProgressReporter({
    workspaceName: "workspace",
    task: "Keep the complete progress sentence",
    model: null,
    edit: async (payload) => edits.push(payload)
  });
  const firstHalf = `進度句子的前半部${"很長但仍需完整保留".repeat(8)}`;
  const secondHalf = "，這是不可被截斷的結尾。";

  progress.update({ method: "item/agentMessage/delta", params: { itemId: "message-1", delta: firstHalf } });
  progress.update({ method: "item/agentMessage/delta", params: { itemId: "message-1", delta: secondHalf } });
  const retainedProgress = await progress.finish();

  assert.deepEqual(retainedProgress, [`進度：${firstHalf}${secondHalf}`]);
  assert.match(edits.at(-1).content, /這是不可被截斷的結尾。/);
});

test("unfinished streamed fragments and final-answer deltas are not retained as progress", async () => {
  const progress = createProgressReporter({
    workspaceName: "workspace",
    task: "Keep only complete progress",
    model: null,
    edit: async () => {}
  });

  progress.update({ method: "item/agentMessage/delta", params: { itemId: "partial", delta: "尚未完成的半句" } });
  progress.update({ method: "item/started", params: { item: { id: "answer", type: "agentMessage", phase: "final_answer" } } });
  progress.update({ method: "item/agentMessage/delta", params: { itemId: "answer", delta: "這是正式答案，不是進度。" } });
  progress.update({ method: "item/completed", params: { item: { id: "answer", type: "agentMessage" } } });

  assert.deepEqual(await progress.finish(), []);
});

test("a completed commentary item is retained even when no delta notification arrived", async () => {
  const progress = createProgressReporter({
    workspaceName: "workspace",
    task: "Retain completed commentary",
    model: null,
    edit: async () => {}
  });

  progress.update({
    method: "item/completed",
    params: { item: { id: "commentary", type: "agentMessage", phase: "commentary", text: "已完成檢查，接著整理結果。" } }
  });

  assert.deepEqual(await progress.finish(), ["進度：已完成檢查，接著整理結果。"]);
});

test("model autocomplete shows only the current Codex catalog plus the local default", () => {
  const models = [
    { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", isDefault: true },
    { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", isDefault: false }
  ];

  assert.deepEqual(modelAutocompleteChoices(models), [
    { name: "Codex local default", value: "default" },
    { name: "GPT-5.6 Sol — gpt-5.6-sol", value: "gpt-5.6-sol" },
    { name: "GPT-5.6 Luna — gpt-5.6-luna", value: "gpt-5.6-luna" }
  ]);
  assert.deepEqual(modelAutocompleteChoices(models, "luna"), [
    { name: "GPT-5.6 Luna — gpt-5.6-luna", value: "gpt-5.6-luna" }
  ]);
});

test("reasoning autocomplete uses only depths supported by the active model", () => {
  const model = {
    id: "gpt-5.6-sol",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast responses" },
      { reasoningEffort: "medium", description: "Balanced" },
      { reasoningEffort: "high", description: "Deep analysis" }
    ]
  };

  assert.deepEqual(reasoningAutocompleteChoices(model), [
    { name: "Model default (medium)", value: "default" },
    { name: "low — Fast responses", value: "low" },
    { name: "medium — Balanced", value: "medium" },
    { name: "high — Deep analysis", value: "high" }
  ]);
  assert.deepEqual(reasoningAutocompleteChoices(model, "deep"), [
    { name: "high — Deep analysis", value: "high" }
  ]);
});

test("image uploads accept only trusted Discord image attachments for image-capable models", () => {
  const imageModel = { inputModalities: ["text", "image"] };
  const image = {
    url: "https://cdn.discordapp.com/attachments/123/456/screenshot.png",
    contentType: "image/png",
    name: "screenshot.png",
    size: 1_024
  };

  assert.deepEqual(imageUrlsForAttachments([image], imageModel), [image.url]);
  assert.throws(() => imageUrlsForAttachments([image], { inputModalities: ["text"] }), /does not support image/);
  assert.throws(() => imageUrlsForAttachments([{ ...image, contentType: "application/pdf" }], imageModel), /Only PNG/);
  assert.throws(() => imageUrlsForAttachments([{ ...image, url: "https://example.com/screenshot.png" }], imageModel), /trusted Discord CDN/);
  assert.throws(() => imageUrlsForAttachments(Array.from({ length: 5 }, () => image), imageModel), /at most 4/);
});

test("output attachment failures preserve the final text and explain the missing permission", async () => {
  const edits = [];
  const sends = [];
  const warnings = [];
  const status = {
    edit: async payload => edits.push(payload),
    channel: { send: async payload => { sends.push(payload); throw Object.assign(new Error("Missing Permissions"), { code: 50_013 }); } }
  };

  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    assert.equal(await statusChunks(status, "Codex finished. [result](/tmp/result.png)", [{ attachment: "/tmp/result.png", name: "result.png" }]), false);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(sends.length, 1, "failed attachment delivery is not blindly retried");
  assert.equal(sends[0].files.length, 1);
  assert.equal(edits.length, 1);
  assert.match(edits[0].content, /Codex finished/);
  assert.match(edits[0].content, /Attach Files/);
  assert.match(edits[0].content, /附件交付未完成/);
  assert.ok(!edits[0].content.includes("/tmp/"));
  assert.deepEqual(warnings, ["Discord attachment delivery unconfirmed for 1 file(s)."]);
});

test("resolved HTTP requests without a complete attachment receipt cannot claim delivery", async () => {
  const files = [{ attachment: "/tmp/a.jar", name: "a.jar" }, { attachment: "/tmp/b.png", name: "b.png" }];
  const good = { id: "1", name: "a.jar", size: 5, url: "https://cdn.discordapp.com/attachments/1/2/a.jar" };
  const receipts = [undefined, { attachments: new Map() }, { attachments: new Map([["1", good]]) },
    { attachments: new Map([["1", { ...good, url: "file:///tmp/a.jar" }]]) }];
  for (const receipt of receipts) {
    const edits = [], sends = [];
    const status = { edit: async payload => edits.push(payload), channel: { send: async payload => { sends.push(payload); return receipt; } } };
    assert.equal(await statusChunks(status, "[jar](/tmp/a.jar) [image](/tmp/b.png)", files), false);
    assert.equal(sends.filter(send => send.files).length, 1, "never blindly repeat an uncertain upload");
    assert.match(edits.at(-1).content, /Discord 回覆未包含全部預期附件/);
    assert.ok(!edits.at(-1).content.includes("/tmp/"));
    assert.ok(!edits.at(-1).content.includes("附件已另行傳送並由 Discord 確認"));
  }
});

test("size rejection is explicit, long text stays sanitized and network errors do not leak", async () => {
  for (const error of [Object.assign(new Error("private /secret/token"), { status: 413 }), new Error("private /secret/token")]) {
    const edits = [], sends = [];
    const status = { edit: async payload => edits.push(payload),
      channel: { send: async payload => { sends.push(payload); if (payload.files) throw error; } } };
    assert.equal(await statusChunks(status, "detail ".repeat(400) + "[file](/tmp/result.jar)",
      [{ attachment: "/tmp/result.jar", name: "result.jar" }]), false);
    assert.match(edits.at(-1).content, error.status === 413 ? /大小限制/ : /結果不明/);
    for (const payload of [...edits, ...sends]) {
      assert.ok(!payload.content.includes("/tmp/"));
      assert.ok(!payload.content.includes("/secret/"));
      assert.deepEqual(payload.allowedMentions, { parse: [] });
    }
  }
});

test("a deleted Discord status message cannot crash task cleanup", async () => {
  let edits = 0;
  let sends = 0;
  const missing = Object.assign(new Error("Unknown Message"), { code: 10_008 });
  const status = {
    edit: async () => {
      edits += 1;
      throw missing;
    },
    channel: { send: async () => { sends += 1; } }
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    assert.equal(await safeStatusChunks(status, "Codex finished."), false);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(edits, 1);
  assert.equal(sends, 0);
  assert.deepEqual(warnings, ["Discord status message no longer exists; skipping its final update."]);
});

test("usage results show remaining quota and Discord reset times without account details", () => {
  const content = formatUsageResult({
    rateLimitsByLimitId: {
      codex: {
        limitId: "codex",
        limitName: "Codex",
        primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1_730_947_200 },
        secondary: { usedPercent: 42, windowDurationMins: 60, resetsAt: 1_730_950_800 }
      }
    },
    rateLimitResetCredits: { availableCount: 2 }
  });

  assert.match(content, /Codex 剩餘用量/);
  assert.match(content, /主要額度（15 分鐘）：剩餘 \*\*75%\*\*，將於 <t:1730947200:R> 重置/);
  assert.match(content, /次要額度（60 分鐘）：剩餘 \*\*58%\*\*，將於 <t:1730950800:R> 重置/);
  assert.match(content, /可用的額度重設次數：\*\*2\*\*/);
});

test("usage presence shows compact remaining windows on the Bot activity", () => {
  const usage = {
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 25, windowDurationMins: 300 },
      secondary: { usedPercent: 42, windowDurationMins: 10_080 }
    }
  };
  let presence = null;
  const text = applyUsagePresence({ user: { setPresence: (value) => { presence = value; } } }, usage);

  assert.equal(text, "剩餘用量：5h 75% · 7d 58%");
  assert.equal(usagePresenceText({}), "剩餘用量：暫無資料");
  assert.deepEqual(presence, {
    activities: [{ name: "剩餘用量：5h 75% · 7d 58%", type: 3 }],
    status: "online"
  });
});
