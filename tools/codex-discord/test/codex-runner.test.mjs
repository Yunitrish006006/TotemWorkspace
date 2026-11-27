import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { approvalResponse, CodexRunner, finalAgentMessage, generatedImagePaths, imageInputs, isAutoApprovedGradleCompile, threadForkParams, threadResumeParams, threadStartParams, turnStartParams, turnSteerParams, validateModel, validatePrompt, validateReasoningEffort } from "../src/codex-runner.mjs";
import { taskKey } from "../src/session-store.mjs";
import { NO_GOAL_REVISION, nativeGoalRevision } from '../../../intelligence/agent-runtime/goal-lifecycle.mjs';
import { acquireRuntimeWriteLease } from '../../../intelligence/agent-runtime/write-leases.mjs';

const leaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "totem-runtime-test-locks-"));
after(() => fs.rmSync(leaseDirectory, { recursive: true, force: true }));

test("Codex App Server sessions always confine writes to the selected workspace", () => {
  const start = threadStartParams({ workspace: "/srv/nexus", model: "gpt-5.6-terra" });
  assert.deepEqual(start, {
    cwd: "/srv/nexus",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    developerInstructions: start.developerInstructions,
    model: "gpt-5.6-terra"
  });
  assert.match(start.developerInstructions, /does not prescribe your internal agent topology/);
  assert.match(start.developerInstructions, /lightweight\/Spark/);
  assert.match(start.developerInstructions, /total model-token consumption/);
  assert.equal(JSON.stringify(start).includes("danger-full-access"), false);
  const goalStart = threadStartParams({ workspace: '/srv/nexus', model: 'gpt-6-astra', reasoningEffort: 'high',
    runtimeWorkspaceRoots: ['/srv/nexus', '/srv/core'] });
  assert.deepEqual(goalStart.config, { model_reasoning_effort: 'high' });
  assert.deepEqual(goalStart.runtimeWorkspaceRoots, ['/srv/nexus', '/srv/core']);
  const goalResume = threadResumeParams({ threadId: 'thread-123', workspace: '/srv/nexus',
    model: 'gpt-6-astra', reasoningEffort: 'high', runtimeWorkspaceRoots: ['/srv/nexus'], excludeTurns: true });
  assert.deepEqual(goalResume.config, { model_reasoning_effort: 'high' });
  assert.deepEqual(goalResume.runtimeWorkspaceRoots, ['/srv/nexus']);
  const resumed = threadResumeParams({ threadId: "thread-123", workspace: "/srv/nexus" });
  assert.equal(resumed.cwd, "/srv/nexus");
  assert.equal(resumed.developerInstructions, start.developerInstructions);
  assert.equal('excludeTurns' in resumed, false);
  assert.equal(threadResumeParams({ threadId: 'fork-thread', workspace: '/srv/nexus', excludeTurns: true }).excludeTurns, true);

  const turn = turnStartParams({
    threadId: "thread-123",
    workspace: "/srv/nexus",
    prompt: "Run tests",
    reasoningEffort: "high",
    imageUrls: ["https://cdn.discordapp.com/attachments/1/2/screenshot.png"]
  });
  assert.deepEqual(turn.sandboxPolicy, {
    type: "workspaceWrite",
    writableRoots: ["/srv/nexus"],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  });
  assert.deepEqual(turn.input, [
    { type: "text", text: "Run tests" },
    { type: "image", url: "https://cdn.discordapp.com/attachments/1/2/screenshot.png" }
  ]);
  assert.equal(turn.effort, "high");

  const steer = turnSteerParams({
    threadId: "thread-123",
    expectedTurnId: "turn-456",
    prompt: "Focus on the failing tests first.",
    imageUrls: ["https://cdn.discordapp.com/attachments/1/2/screenshot.png"],
    clientUserMessageId: "123456789"
  });
  assert.deepEqual(steer, {
    threadId: "thread-123",
    expectedTurnId: "turn-456",
    input: [
      { type: "text", text: "Focus on the failing tests first." },
      { type: "image", url: "https://cdn.discordapp.com/attachments/1/2/screenshot.png" }
    ],
    clientUserMessageId: "123456789"
  });
  assert.equal(Object.hasOwn(steer, "cwd"), false);
  assert.equal(Object.hasOwn(steer, "model"), false);
  assert.equal(Object.hasOwn(steer, "sandboxPolicy"), false);
});

test('history forks are pinned to the completed turn and inherit current runtime policy', () => {
  const params = threadForkParams({ threadId: 'source-thread', lastTurnId: 'completed-turn', workspace: '/srv/nexus', readOnly: true });
  assert.equal(params.threadId, 'source-thread');
  assert.equal(params.lastTurnId, 'completed-turn');
  assert.equal(params.deferGoalContinuation, true);
  assert.equal(params.excludeTurns, true);
  assert.equal(params.cwd, '/srv/nexus');
  assert.equal(params.sandbox, 'read-only');
  assert.equal(params.approvalPolicy, 'on-request');
  assert.throws(() => threadForkParams({ threadId: 'source-thread', lastTurnId: '', workspace: '/srv/nexus' }));
});

test("approval responses are scoped and never auto-grant unrequested permissions", () => {
  const command = { kind: "command", availableDecisions: ["accept", "decline"] };
  assert.deepEqual(approvalResponse(command, "allow"), { decision: "accept" });
  assert.throws(() => approvalResponse(command, "allow-session"), /not available/);
  assert.deepEqual(approvalResponse({ kind: "command", availableDecisions: ["accept", "cancel"] }, "decline"), { decision: "cancel" });
  assert.deepEqual(approvalResponse({ kind: "file-change" }, "decline"), { decision: "decline" });

  const permissions = {
    kind: "permissions",
    permissions: { network: { host: ["example.com"] }, fileSystem: null }
  };
  assert.deepEqual(approvalResponse(permissions, "allow"), {
    permissions: { network: { host: ["example.com"] } },
    scope: "turn"
  });
  assert.deepEqual(approvalResponse(permissions, "allow-session"), {
    permissions: { network: { host: ["example.com"] } },
    scope: "session"
  });
  assert.deepEqual(approvalResponse(permissions, "decline"), { permissions: {}, scope: "turn" });
});

test("only direct Gradle compile, test, and build commands are automatically approved", () => {
  const approval = (command, availableDecisions = ["accept", "decline"]) => ({ kind: "command", command, availableDecisions });
  assert.equal(isAutoApprovedGradleCompile(approval("./gradlew :module:compileJava --no-daemon")), true);
  assert.equal(isAutoApprovedGradleCompile(approval("../TotemCore/gradlew build --stacktrace")), true);
  assert.equal(isAutoApprovedGradleCompile(approval("./gradlew clean build")), false);
  assert.equal(isAutoApprovedGradleCompile(approval("./gradlew publish")), false);
  assert.equal(isAutoApprovedGradleCompile(approval("bash -lc './gradlew build'")), false);
  assert.equal(isAutoApprovedGradleCompile(approval("./gradlew build -Pversion=1.2.3")), false);
  assert.equal(isAutoApprovedGradleCompile(approval("./gradlew build", ["decline"])), false);
  assert.equal(isAutoApprovedGradleCompile({ ...approval("./gradlew build"), network: { host: "repo.example" } }), false);
  assert.equal(isAutoApprovedGradleCompile({ kind: "permissions", command: "./gradlew build" }), false);
});

test("final messages and user input are validated before reaching Codex", () => {
  assert.equal(finalAgentMessage({ items: [{ type: "agentMessage", text: " first " }, { type: "agentMessage", text: " final " }] }), "final");
  assert.equal(validatePrompt("  Update the tests  "), "Update the tests");
  assert.throws(() => validatePrompt(""), /cannot be empty/);
  assert.equal(validateModel("gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(validateModel("default"), null);
  assert.throws(() => validateModel("bad model name"), /Model name/);
  assert.equal(validateReasoningEffort("xhigh"), "xhigh");
  assert.equal(validateReasoningEffort("default"), null);
  assert.throws(() => validateReasoningEffort("too deep"), /Reasoning effort/);
  assert.deepEqual(imageInputs(["https://cdn.discordapp.com/attachments/1/2/screenshot.png"]), [
    { type: "image", url: "https://cdn.discordapp.com/attachments/1/2/screenshot.png" }
  ]);
  assert.throws(() => imageInputs(["http://cdn.discordapp.com/attachments/1/2/screenshot.png"]), /HTTPS/);
  assert.deepEqual(generatedImagePaths({ items: [
    { type: "imageGeneration", savedPath: "/tmp/generated.png", status: "completed" },
    { type: "agentMessage", text: "done" }
  ] }), ["/tmp/generated.png"]);
});

test("the model catalog uses only picker-visible models reported by Codex", async () => {
  const child = new FakeAppServer((request, respond) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "model/list" && !request.params.cursor) {
      respond({
        id: request.id,
        result: {
          data: [
            {
              id: "gpt-5.6-sol",
              model: "gpt-5.6-sol",
              displayName: "GPT-5.6 Sol",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [
                { reasoningEffort: "low", description: "Fast" },
                { reasoningEffort: "medium", description: "Balanced" }
              ]
            },
            { id: "internal", model: "internal", hidden: true },
            { id: "not a model", model: "not a model" }
          ],
          nextCursor: "page-2"
        }
      });
    } else if (request.method === "model/list" && request.params.cursor === "page-2") {
      respond({
        id: request.id,
        result: {
          data: [{
            id: "gpt-5.6-luna",
            model: "gpt-5.6-luna",
            displayName: "GPT-5.6 Luna",
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }]
          }],
          nextCursor: null
        }
      });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ mode: "primary-only", assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });

  const models = await runner.listModels({ workspace: "/srv/nexus" });

  assert.deepEqual(models, [
    {
      id: "gpt-5.6-sol",
      displayName: "GPT-5.6 Sol",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "medium", description: "Balanced" }
      ],
      inputModalities: ["text", "image"]
    },
    {
      id: "gpt-5.6-luna",
      displayName: "GPT-5.6 Luna",
      isDefault: false,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }],
      inputModalities: ["text", "image"]
    }
  ]);
  assert.equal(child.killed, true);
});

test("usage limits are read from the authenticated Codex App Server account", async () => {
  const child = new FakeAppServer((request, respond) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "account/rateLimits/read") {
      assert.equal(request.params, undefined);
      respond({
        id: request.id,
        result: {
          rateLimits: {
            limitId: "codex",
            primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1_730_947_200 },
            secondary: null
          }
        }
      });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ mode: "primary-only", assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });

  const usage = await runner.getUsage({ workspace: "/srv/nexus" });

  assert.deepEqual(usage, {
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1_730_947_200 },
      secondary: null
    }
  });
  assert.equal(child.killed, true);
});

test("an expired saved thread is replaced when its next turn cannot start", async () => {
  let requestedReasoningEffort = null;
  let requestedImageUrls = [];
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/resume") respond({ id: request.id, result: { thread: { id: "saved-thread" } } });
    else if (request.method === "turn/start" && request.params.threadId === "saved-thread") {
      respond({ id: request.id, error: { message: "Conversation expired" } });
    } else if (request.method === "thread/start") respond({ id: request.id, result: { thread: { id: "fresh-thread" } } });
    else if (request.method === "turn/start" && request.params.threadId === "fresh-thread") {
      requestedReasoningEffort = request.params.effort;
      requestedImageUrls = request.params.input.filter((input) => input.type === "image").map((input) => input.url);
      respond({ id: request.id, result: { turn: { id: "turn-1" } } });
      notify({
        method: "item/completed",
        params: { item: { id: "image-1", type: "imageGeneration", status: "completed", result: "ok", savedPath: "/tmp/generated.png" } }
      });
      notify({
        method: "turn/completed",
        params: { turn: { status: "completed", items: [{ type: "agentMessage", text: "Fresh session completed." }] } }
      });
    }
  });
  const saved = [];
  const progress = [];
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ mode: "primary-only", assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });

  const result = await runner.execute({
    key: "user:channel:workspace",
    workspace: "/srv/nexus",
    prompt: "Continue the task",
    reasoningEffort: "high",
    imageUrls: ["https://cdn.discordapp.com/attachments/1/2/screenshot.png"],
    resumeSessionId: "saved-thread",
    onSessionId: async (sessionId) => saved.push(sessionId),
    onProgress: async (event) => progress.push(event.method)
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.sessionId, "fresh-thread");
  assert.equal(result.message, "Codex 工作: 1/1\nFresh session completed.");
  assert.deepEqual(result.imagePaths, ["/tmp/generated.png"]);
  assert.deepEqual(saved, ["fresh-thread"]);
  assert.ok(progress.includes("bridge/sessionReset"));
  assert.equal(requestedReasoningEffort, "high");
  assert.deepEqual(requestedImageUrls, ["https://cdn.discordapp.com/attachments/1/2/screenshot.png"]);
});

test("an ambiguous request is not replayed into a fresh thread after session expiry", async () => {
  let freshStarts = 0;
  const child = new FakeAppServer((request, respond) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/resume") respond({ id: request.id, result: { thread: { id: "saved-thread" } } });
    else if (request.method === "turn/start") respond({ id: request.id, error: { message: "Conversation expired" } });
    else if (request.method === "thread/start") freshStarts++;
  });
  const runner = new CodexRunner({ leaseDirectory, spawnImpl: () => child,
    probeRuntime: async () => ({ ...await fakeRuntime(),
      threadRoutingState: { query: 'Continue TotemLumen renderer work', contextTokens: 20000 } }),
    planImpl: () => ({ contextHints: {}, writeScope: [] }), maxRuntimeMs: 1_000 });
  await assert.rejects(runner.execute({ key: 'ambiguous-expired', workspace: '/tmp',
    resumeSessionId: 'saved-thread', prompt: '還有能改善的地方嗎' }), /Restate the task/);
  assert.equal(freshStarts, 0);
});

test("an ambiguous request is rejected when thread resume itself reports expiry", async () => {
  let freshStarts = 0;
  const child = new FakeAppServer((request, respond) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/resume") respond({ id: request.id,
      error: { message: "Conversation expired" } });
    else if (request.method === "thread/start") freshStarts++;
  });
  const runner = new CodexRunner({ leaseDirectory, spawnImpl: () => child,
    probeRuntime: async () => ({ ...await fakeRuntime(),
      threadRoutingState: { query: 'Continue TotemLumen renderer work', contextTokens: 20000 } }),
    planImpl: () => ({ contextHints: {}, writeScope: [] }), maxRuntimeMs: 1_000 });
  await assert.rejects(runner.execute({ key: 'ambiguous-resume-expired', workspace: '/tmp',
    resumeSessionId: 'saved-thread', prompt: '還有能改善的地方嗎' }), /Restate the task/);
  assert.equal(freshStarts, 0);
});

test('usage context limit interrupts without claiming completion or replaying', async () => {
  let interrupted = 0;
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'budget-thread' } } });
    else if (request.method === 'turn/start') {
      respond({ id: request.id, result: { turn: { id: 'budget-turn' } } });
      notify({ method: 'thread/tokenUsage/updated', params: { threadId: 'budget-thread', turnId: 'budget-turn', tokenUsage: {
        last: { inputTokens: 65000 }, total: { inputTokens: 100000, outputTokens: 1000 }
      } } });
    } else if (request.method === 'turn/interrupt') {
      interrupted += 1;
      respond({ id: request.id, result: {} });
      notify({ method: 'turn/completed', params: { turn: { status: 'interrupted', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ waves: [] }), maxRuntimeMs: 5000, spawnImpl: () => child });
  const result = await runner.execute({ key: 'budget-test', workspace: '/srv/nexus', prompt: 'Inspect bounded files' });
  assert.equal(interrupted, 1);
  assert.equal(result.exitCode, 1);
  assert.equal(result.usageSummary.stopped, true);
  assert.equal(result.usageSummary.modelTurns, null);
  assert.match(result.message, /paused, not completed/);
});

test("zero max runtime leaves a Codex task running until it completes", async () => {
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/start") {
      respond({ id: request.id, result: { thread: { id: "unlimited-thread" } } });
    } else if (request.method === "turn/start") {
      respond({ id: request.id, result: { turn: { id: "turn-1" } } });
      setTimeout(() => notify({
        method: "turn/completed",
        params: { turn: { status: "completed", items: [{ type: "agentMessage", text: "Completed without a deadline." }] } }
      }), 20);
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ mode: "primary-only", assignments: [] }), maxRuntimeMs: 0, spawnImpl: () => child });

  const result = await runner.execute({
    key: "user:channel:workspace",
    workspace: "/srv/nexus",
    prompt: "Finish eventually"
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.message, "Codex 工作: 1/1\nCompleted without a deadline.");
});

test("workspace write lease blocks concurrent runs for different users and Discord threads", async () => {
  let started;
  const turnStarted = new Promise((resolve) => { started = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/start") respond({ id: request.id, result: { thread: { id: "locked-thread" } } });
    else if (request.method === "turn/start") {
      respond({ id: request.id, result: { turn: { id: "locked-turn" } } });
      started();
    } else if (request.method === "turn/interrupt") {
      respond({ id: request.id, result: {} });
      notify({ method: "turn/completed", params: { turn: { status: "interrupted", items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ mode: "primary-only", assignments: [] }), maxRuntimeMs: 0, spawnImpl: () => child });
  const firstThreadKey = taskKey({ userId: "user-a", channelId: "discord-thread-a", workspace: "core" });
  const secondThreadKey = taskKey({ userId: "user-b", channelId: "discord-thread-b", workspace: "core" });
  const first = runner.execute({ key: firstThreadKey, workspace: "/srv/core", prompt: "Keep working" });

  await turnStarted;
  await assert.rejects(
    runner.execute({ key: secondThreadKey, workspace: "/srv/core", prompt: "Start conflicting work" }),
    /already running|overlapping writable root/
  );
  runner.cancel(firstThreadKey);
  await first;
});

test("steering uses the active turn IDs, image input, and FIFO request order", async () => {
  const key = "user:channel:workspace";
  const steerRequests = [];
  let started;
  const startedTurn = new Promise((resolve) => { started = resolve; });
  let complete;
  const completedTurn = new Promise((resolve) => { complete = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/start") respond({ id: request.id, result: { thread: { id: "steer-thread" } } });
    else if (request.method === "turn/start") {
      respond({ id: request.id, result: { turn: { id: "steer-turn" } } });
      started();
    } else if (request.method === "turn/steer") {
      steerRequests.push(request.params);
      respond({ id: request.id, result: { turnId: "steer-turn" } });
      if (steerRequests.length === 2) complete();
    } else if (request.method === "test/complete") {
      notify({ method: "turn/completed", params: { turn: { status: "completed", items: [{ type: "agentMessage", text: "Steered." }] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ mode: "primary-only", assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const run = runner.execute({ key, workspace: "/srv/nexus", prompt: "Start the work" });

  await startedTurn;
  const first = runner.steer(key, {
    prompt: "Check failing tests first.",
    imageUrls: ["https://cdn.discordapp.com/attachments/1/2/first.png"],
    clientUserMessageId: "discord-1"
  });
  const second = runner.steer(key, { prompt: "Then summarize the fixes.", clientUserMessageId: "discord-2" });

  await Promise.all([first, second]);
  await completedTurn;
  child.stdin.write(`${JSON.stringify({ method: "test/complete" })}\n`);
  const result = await run;

  assert.equal(result.exitCode, 0);
  assert.deepEqual(steerRequests, [
    {
      threadId: "steer-thread",
      expectedTurnId: "steer-turn",
      input: [
        { type: "text", text: "Check failing tests first." },
        { type: "image", url: "https://cdn.discordapp.com/attachments/1/2/first.png" }
      ],
      clientUserMessageId: "discord-1"
    },
    {
      threadId: "steer-thread",
      expectedTurnId: "steer-turn",
      input: [{ type: "text", text: "Then summarize the fixes." }],
      clientUserMessageId: "discord-2"
    }
  ]);
});

test("early steering waits for turn IDs and rejects truthfully when the turn completes first", async () => {
  const key = "user:channel:workspace";
  let sawSteer = false;
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/start") respond({ id: request.id, result: { thread: { id: "race-thread" } } });
    else if (request.method === "turn/start") {
      respond({ id: request.id, result: { turn: { id: "race-turn" } } });
      notify({ method: "turn/completed", params: { turn: { status: "completed", items: [{ type: "agentMessage", text: "Already done." }] } } });
    } else if (request.method === "turn/steer") {
      sawSteer = true;
      respond({ id: request.id, result: { turnId: "race-turn" } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ mode: "primary-only", assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const run = runner.execute({ key, workspace: "/srv/nexus", prompt: "Finish quickly" });
  const steering = runner.steer(key, { prompt: "Actually wait." });

  await assert.rejects(steering, /no longer accepting steering input.*completed before/i);
  const result = await run;
  assert.equal(result.message, "Codex 工作: 1/1\nAlready done.");
  // The request was held until turn/start supplied IDs. The completion raced
  // with its response, so the user still receives a truthful rejection.
  assert.equal(sawSteer, true);
  await assert.rejects(runner.steer(key, { prompt: "Too late." }), /No active Codex turn is available to steer/);
});

test("task-scoped automatic approval accepts current and subsequent permission types", async () => {
  const key = "user:channel:workspace";
  const decisions = [];
  let approvalPrompts = 0;
  let runner;
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/start") {
      respond({ id: request.id, result: { thread: { id: "approval-thread" } } });
    } else if (request.method === "turn/start") {
      respond({ id: request.id, result: { turn: { id: "turn-1" } } });
      notify({
        id: 101,
        method: "item/permissions/requestApproval",
        params: { permissions: { network: { host: ["example.com"] } } }
      });
    } else if (request.id === 101 && request.result) {
      decisions.push(request.result);
      notify({
        id: 102,
        method: "item/commandExecution/requestApproval",
        params: { command: "npm install", availableDecisions: ["accept", "decline"] }
      });
    } else if (request.id === 102 && request.result) {
      decisions.push(request.result);
      notify({
        method: "turn/completed",
        params: { turn: { status: "completed", items: [{ type: "agentMessage", text: "Approved task completed." }] } }
      });
    }
  });
  runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ mode: "primary-only", assignments: [] }), maxRuntimeMs: 0, spawnImpl: () => child });

  const result = await runner.execute({
    key,
    workspace: "/srv/nexus",
    prompt: "Complete the approved task",
    onApproval: (approval) => {
      approvalPrompts += 1;
      assert.equal(runner.approveAll(key, approval.requestId), true);
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(approvalPrompts, 1);
  assert.deepEqual(decisions, [
    { permissions: { network: { host: ["example.com"] } }, scope: "turn" },
    { decision: "accept" }
  ]);
});

class FakeAppServer extends EventEmitter {
  constructor(handleRequest, { completeThreadResponses = true } = {}) {
    super();
    this.killed = false;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = {
      destroyed: false,
      write: (line) => {
        const request = JSON.parse(line);
        queueMicrotask(() => handleRequest(request, (response) => {
          if (completeThreadResponses && ['thread/start', 'thread/resume'].includes(request.method)
              && response?.result?.thread) {
            const result = response.result;
            const sandbox = request.params?.sandbox === 'read-only'
              ? { type: 'readOnly', networkAccess: false }
              : { type: 'workspaceWrite', networkAccess: false };
            response = { ...response, result: {
              model: result.model ?? request.params?.model ?? result.thread.model ?? 'gpt-6-astra',
              reasoningEffort: result.reasoningEffort ?? request.params?.config?.model_reasoning_effort ?? 'medium',
              cwd: result.cwd ?? request.params?.cwd,
              approvalPolicy: result.approvalPolicy ?? request.params?.approvalPolicy ?? 'on-request',
              approvalsReviewer: result.approvalsReviewer ?? request.params?.approvalsReviewer ?? 'user',
              sandbox: result.sandbox ?? sandbox,
              runtimeWorkspaceRoots: result.runtimeWorkspaceRoots ?? request.params?.runtimeWorkspaceRoots ?? [],
              ...result
            } };
          }
          this.#send(response);
        }, (notification) => this.#send(notification)));
        return true;
      }
    };
  }

  kill() {
    this.killed = true;
    this.stdin.destroyed = true;
    queueMicrotask(() => this.emit("close", 0, "SIGTERM"));
    return true;
  }

  #send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

test('native Goal run uses the Goal scheduler for both turns and holds its workspace lease until terminal close', async () => {
  const events = [];
  const progressEvents = [];
  let goal = null;
  let markActivated;
  const activated = new Promise(resolve => { markActivated = resolve; });
  let markActivationStatus;
  const activationStatusReported = new Promise(resolve => { markActivationStatus = resolve; });
  let markWaiting;
  const waitingAfterFirst = new Promise(resolve => { markWaiting = resolve; });
  let markSecondStarted;
  const secondStarted = new Promise(resolve => { markSecondStarted = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      events.push(`goal-set:${request.params.status}`);
      goal = { threadId: request.params.threadId, objective: request.params.objective ?? goal?.objective,
        status: request.params.status, tokenBudget: request.params.tokenBudget ?? null, tokensUsed: 0 };
      respond({ id: request.id, result: { goal } });
      notify({ method: 'thread/goal/updated', params: { threadId: 'goal-thread', goal } });
      notify({ method: 'thread/tokenUsage/updated', params: { threadId: 'goal-thread', turnId: 'goal-turn-1',
        tokenUsage: { total: { inputTokens: 100, outputTokens: 2 }, last: { inputTokens: 20 } } } });
      notify({ method: 'thread/tokenUsage/updated', params: { threadId: 'goal-thread', turnId: 'goal-turn-1',
        tokenUsage: { total: { inputTokens: 120, outputTokens: 3 }, last: { inputTokens: 30 } } } });
      notify({ method: 'item/started', params: { threadId: 'goal-thread', turnId: 'goal-turn-1',
        item: { id: 'tool-reused-id', type: 'commandExecution' } } });
      notify({ method: 'item/started', params: { threadId: 'goal-thread', turnId: 'goal-turn-1',
        item: { id: 'tool-reused-id', type: 'commandExecution' } } });
      notify({ method: 'turn/started', params: { threadId: 'goal-thread', turn: { id: 'goal-turn-1', threadId: 'goal-thread' } } });
      markActivated();
    } else if (request.method === 'turn/start') {
      events.push('client-turn-start');
      respond({ id: request.id, result: { turn: { id: 'unexpected' } } });
    } else if (request.method === 'turn/interrupt') respond({ id: request.id, result: {} });
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'native-goal-two-turns', workspace: '/srv/nexus', prompt: 'Start Goal',
    goalRun: { objective: 'Complete the bounded test objective', tokenBudget: 9_000 },
    onProgress: event => {
      progressEvents.push(event);
      if (event.method === 'bridge/goalStatus' && event.params.status === 'active'
          && event.params.tokenBudget === 9_000) markActivationStatus(event);
      if (event.method === 'bridge/goalStatus' && event.params.turnsCompleted === 1 && event.params.state === 'waiting') markWaiting();
      if (event.method === 'turn/started' && event.params.turn?.id === 'goal-turn-2') markSecondStarted();
    } });

  await activated;
  const activationStatus = await activationStatusReported;
  assert.equal(activationStatus?.params.tokensUsed, 0,
    `Goal status projection includes only bounded native counters: ${JSON.stringify(activationStatus?.params)}`);
  assert.equal(Object.hasOwn(activationStatus?.params ?? {}, 'threadId'), false, 'Goal status projection does not expose native thread identity');
  assert.equal(runner.isRunning('native-goal-two-turns'), true);
  assert.equal(child.killed, false, 'the first turn completion must not terminate the App Server');
  assert.deepEqual(events, ['goal-set:active']);
  await assert.rejects(runner.execute({ key: 'overlapping-goal-run', workspace: '/srv/nexus', prompt: 'Must wait' }),
    /overlapping writable root|workspace\.lock is held/);

  goal = { ...goal, status: 'active', tokensUsed: 1_000 };
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'goal-thread', turn: { id: 'goal-turn-1', status: 'completed', items: [] }
  } })}\n`);
  await waitingAfterFirst;
  child.stdout.write(`${JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: 'goal-thread', turnId: 'goal-turn-2',
    tokenUsage: { total: { inputTokens: 300, outputTokens: 10 }, last: { inputTokens: 40 } } } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'item/started', params: { threadId: 'goal-thread', turnId: 'goal-turn-2',
    item: { id: 'tool-reused-id', type: 'commandExecution' } } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'item/started', params: { threadId: 'goal-thread', turnId: 'goal-turn-2',
    item: { id: 'tool-reused-id', type: 'commandExecution' } } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'turn/started', params: {
    threadId: 'goal-thread', turn: { id: 'goal-turn-2', threadId: 'goal-thread' }
  } })}\n`);
  await secondStarted;
  await assert.rejects(runner.pauseGoal('native-goal-two-turns', {
    threadId: 'goal-thread', turnId: 'goal-turn-1', turnsSeen: 1
  }), error => error.code === 'GOAL_TURN_CONFLICT', 'a stale activity control cannot pause the next native turn');
  assert.deepEqual(events, ['goal-set:active'], 'stale turn rejection must not mutate native Goal state');
  goal = { ...goal, status: 'complete', tokensUsed: 1_500 };
  child.stdout.write(`${JSON.stringify({ method: 'thread/goal/updated', params: { threadId: 'goal-thread', goal } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'goal-thread', turn: { id: 'goal-turn-2', status: 'completed', items: [] }
  } })}\n`);

  const result = await resultPromise;
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.goal, { status: 'complete', turnsSeen: 2, turnsCompleted: 2 });
  assert.equal(result.usageSummary.observedToolCalls, 2, 'same item IDs in two generations count once per distinct turn');
  assert.equal(result.usageSummary.threadInputTokens, 300, 'pre-start token snapshots are coalesced and attached to their exact turn');
  assert.deepEqual(events, ['goal-set:active']);
  assert.equal(child.killed, true);
});

test('native Goal process close wins over pending terminal read-back and ignores late replies', async () => {
  let goal = null;
  let emit;
  let readbackCount = 0;
  let replyToReadback;
  let markStarted;
  let markReadbackPending;
  const started = new Promise(resolve => { markStarted = resolve; });
  const readbackPending = new Promise(resolve => { markReadbackPending = resolve; });
  const requests = [];
  const child = new FakeAppServer((request, respond, notify) => {
    requests.push(request.method);
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'close-race-goal-thread' } } });
    else if (request.method === 'thread/goal/get') {
      readbackCount++;
      if (readbackCount === 3) {
        replyToReadback = () => respond({ id: request.id, result: { goal } });
        markReadbackPending();
      } else respond({ id: request.id, result: { goal } });
    } else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'close-race-goal-thread', objective: request.params.objective ?? goal?.objective,
        status: request.params.status, tokensUsed: 0 };
      respond({ id: request.id, result: { goal } });
      if (request.params.status === 'active') {
        emit = notify;
        notify({ method: 'turn/started', params: { threadId: goal.threadId,
          turn: { id: 'close-race-goal-turn' } } });
      }
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const key = 'close-race-goal';
  const workspace = '/srv/close-race-goal';
  const resultPromise = runner.execute({ key, workspace, prompt: 'Start', goalRun: { objective: 'Wait for terminal evidence' },
    onProgress: event => { if (event.method === 'turn/started') markStarted(); } });
  await started;
  goal = { ...goal, status: 'complete' };
  emit({ method: 'thread/goal/updated', params: { threadId: goal.threadId, goal } });
  emit({ method: 'turn/completed', params: { threadId: goal.threadId,
    turn: { id: 'close-race-goal-turn', status: 'completed', items: [] } } });
  await readbackPending;
  child.emit('close', 17, 'SIGTERM');
  await assert.rejects(resultPromise, /App Server closed before native Goal settlement/);
  replyToReadback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runner.isRunning(key), false);
  assert.equal(requests.includes('thread/resume'), false);
  assert.equal(requests.includes('turn/start'), false);
  assert.equal(requests.filter(method => method === 'thread/goal/set').length, 1);
  const release = acquireRuntimeWriteLease([workspace], { owner: 'after-close-race-goal', lockDirectory: leaseDirectory });
  release();
});

test('malformed App Server frame fails a native Goal closed and releases its lease after close', async () => {
  let goal = null;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const requests = [];
  const child = new FakeAppServer((request, respond, notify) => {
    requests.push(request.method);
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'malformed-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'malformed-goal-thread', objective: request.params.objective,
        status: request.params.status, tokensUsed: 0 };
      respond({ id: request.id, result: { goal } });
      if (request.params.status === 'active') notify({ method: 'turn/started', params: { threadId: goal.threadId,
        turn: { id: 'malformed-goal-turn' } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const key = 'malformed-goal-frame';
  const workspace = '/srv/malformed-goal-frame';
  const resultPromise = runner.execute({ key, workspace, prompt: 'Start', goalRun: { objective: 'Fail on invalid transport' },
    onProgress: event => { if (event.method === 'turn/started') markStarted(); } });
  await started;
  child.stdout.write('{malformed-frame}\n');
  await assert.rejects(resultPromise, error => error.code === 'GOAL_FRAME_INVALID');
  assert.equal(runner.isRunning(key), false);
  assert.equal(requests.includes('thread/resume'), false);
  assert.equal(requests.includes('turn/start'), false);
  const release = acquireRuntimeWriteLease([workspace], { owner: 'after-malformed-goal-frame', lockDirectory: leaseDirectory });
  release();
});

test('native Goal tool budget accumulates across turns and guard stop pauses the Goal', async () => {
  let goal = null;
  let emit;
  let markFirstStarted;
  let markSecondStarted;
  let markGuardStopped;
  let markFirstWaiting;
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
  const secondStarted = new Promise(resolve => { markSecondStarted = resolve; });
  const guardStopped = new Promise(resolve => { markGuardStopped = resolve; });
  const firstWaiting = new Promise(resolve => { markFirstWaiting = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'cumulative-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { ...goal, threadId: 'cumulative-goal-thread', objective: 'Stop at the Goal-wide tool budget', status: request.params.status };
      respond({ id: request.id, result: {} });
      emit = notify;
      if (request.params.status === 'active') {
        for (let index = 0; index < 79; index++) notify({ method: 'item/started', params: {
          threadId: 'cumulative-goal-thread', turnId: 'budget-turn-1', item: { id: `tool-${index}`, type: 'commandExecution' }
        } });
        notify({ method: 'turn/started', params: { threadId: 'cumulative-goal-thread', turn: { id: 'budget-turn-1' } } });
      }
    } else if (request.method === 'turn/interrupt') {
      respond({ id: request.id, result: {} });
      notify({ method: 'turn/completed', params: { threadId: 'cumulative-goal-thread',
        turn: { id: 'budget-turn-2', status: 'interrupted', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'cumulative-goal-budget', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Stop at the Goal-wide tool budget' },
    onProgress: event => {
      if (event.method === 'turn/started' && event.params.turn?.id === 'budget-turn-1') markFirstStarted();
      if (event.method === 'turn/started' && event.params.turn?.id === 'budget-turn-2') markSecondStarted();
      if (event.method === 'bridge/goalStatus' && event.params.turnsCompleted === 1 && event.params.state === 'waiting') markFirstWaiting();
      if (event.method === 'bridge/usageGuard' && event.params.action === 'stop') markGuardStopped();
    } });
  await firstStarted;
  emit({ method: 'turn/completed', params: { threadId: 'cumulative-goal-thread',
    turn: { id: 'budget-turn-1', status: 'completed', items: [] } } });
  await firstWaiting;
  emit({ method: 'turn/started', params: { threadId: 'cumulative-goal-thread', turn: { id: 'budget-turn-2' } } });
  await secondStarted;
  emit({ method: 'item/started', params: { threadId: 'cumulative-goal-thread', turnId: 'budget-turn-2',
    item: { id: 'tool-79', type: 'commandExecution' } } });
  await guardStopped;
  const result = await resultPromise;
  assert.equal(result.exitCode, 1);
  assert.equal(result.goal.status, 'paused');
  assert.equal(result.usageSummary.observedToolCalls, 80);
  assert.equal(result.usageSummary.stopReason, 'tool-limit');
  assert.equal(child.killed, true);
});

test('budget-limited Goal retains its controller and lease until explicit budget update and resume', async () => {
  const threadId = 'budget-supervisor-thread';
  const workspace = '/srv/budget-supervisor';
  const key = 'budget-supervisor';
  let goal = null, emit;
  let markFirstStarted, markBudgetWaiting, markSecondStarted;
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
  const budgetWaiting = new Promise(resolve => { markBudgetWaiting = resolve; });
  const secondStarted = new Promise(resolve => { markSecondStarted = resolve; });
  const requests = [];
  const child = new FakeAppServer((request, respond, notify) => {
    requests.push(request);
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: threadId } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      if (request.params.objective) goal = { threadId, objective: request.params.objective,
        status: request.params.status, tokenBudget: 1000, tokensUsed: 120, timeUsedSeconds: 8,
        createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:01:00Z' };
      else if (Number.isSafeInteger(request.params.tokenBudget)) {
        goal = { ...goal, tokenBudget: request.params.tokenBudget, updatedAt: '2026-10-25T00:02:00Z' };
      } else goal = { ...goal, status: request.params.status };
      respond({ id: request.id, result: { goal } });
      emit = notify;
      if (request.params.status === 'active') {
        const turnId = goal.tokenBudget === 1000 ? 'budget-first-turn' : 'budget-resumed-turn';
        notify({ method: 'turn/started', params: { threadId, turn: { id: turnId } } });
      }
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 30_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key, workspace, prompt: 'Start budget supervised Goal',
    goalRun: { objective: 'Complete after explicit budget confirmation' },
    onProgress: event => {
      const turnId = event.params?.turn?.id;
      if (event.method === 'turn/started' && turnId === 'budget-first-turn') markFirstStarted();
      if (event.method === 'bridge/goalStatus' && event.params?.state === 'budgetLimited') markBudgetWaiting();
      if (event.method === 'turn/started' && turnId === 'budget-resumed-turn') markSecondStarted();
    } });
  await firstStarted;
  goal = { ...goal, status: 'budgetLimited' };
  emit({ method: 'thread/goal/updated', params: { threadId, goal } });
  emit({ method: 'turn/completed', params: { threadId, turn: { id: 'budget-first-turn', status: 'completed', items: [] } } });
  await budgetWaiting;
  assert.equal(runner.isRunning(key), true, 'the same App Server controller must remain available');
  assert.throws(() => acquireRuntimeWriteLease([workspace], { owner: 'budget-supervisor-contender', lockDirectory: leaseDirectory }),
    error => error.code === 'RUNTIME_WRITE_CONFLICT', 'budget-limited waiting must retain the workspace lease');

  emit({ method: 'turn/started', params: { threadId: 'foreign-thread', turn: { id: 'foreign-turn' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(goal.status, 'budgetLimited', 'a foreign turn notification must not alter the local native Goal');
  emit({ method: 'turn/started', params: { threadId, turn: { id: 'budget-first-turn' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(goal.status, 'budgetLimited', 'a replayed prior-process turn must not alter the waiting controller');

  const revision = nativeGoalRevision(goal, threadId);
  const beforeUnknownUsage = requests.filter(entry => entry.method === 'thread/goal/set').length;
  goal = { ...goal, tokensUsed: null };
  await assert.rejects(runner.setGoalBudget(key, 2000, nativeGoalRevision(goal, threadId)), error => error.code === 'GOAL_USAGE_UNKNOWN');
  await assert.rejects(runner.resumeBudgetLimitedGoal(key, nativeGoalRevision(goal, threadId)), error => error.code === 'GOAL_USAGE_UNKNOWN');
  assert.equal(requests.filter(entry => entry.method === 'thread/goal/set').length, beforeUnknownUsage,
    'unknown usage must not issue a native mutation');
  goal = { ...goal, tokensUsed: 120 };
  assert.equal(await runner.setGoalBudget(key, 2000, revision), true);
  assert.equal(goal.status, 'budgetLimited', 'budget update alone must not resume native work');
  assert.equal(goal.tokenBudget, 2000);
  assert.equal(goal.tokensUsed, 120);
  assert.equal(runner.isRunning(key), true);
  assert.equal(requests.filter(entry => entry.method === 'thread/goal/set' && entry.params.status === 'active').length, 1,
    'budget update must not send an active mutation');

  assert.equal(await runner.resumeBudgetLimitedGoal(key, nativeGoalRevision(goal, threadId)), true);
  await secondStarted;
  assert.equal(goal.status, 'active', 'only the explicit resume operation may reactivate the Goal');
  goal = { ...goal, status: 'complete' };
  emit({ method: 'thread/goal/updated', params: { threadId, goal } });
  emit({ method: 'turn/completed', params: { threadId, turn: { id: 'budget-resumed-turn', status: 'completed', items: [] } } });
  const result = await resultPromise;
  assert.equal(result.goal.status, 'complete');
  assert.equal(runner.isRunning(key), false);
  const release = acquireRuntimeWriteLease([workspace], { owner: 'after-budget-supervisor', lockDirectory: leaseDirectory });
  release();
});

test('budget-limited update pauses and interrupts if native read-back activates the Goal', async () => {
  const threadId = 'budget-auto-activation-thread';
  const workspace = '/srv/budget-auto-activation';
  const key = 'budget-auto-activation';
  let goal = null, emit;
  let markFirstStarted, markBudgetWaiting;
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
  const budgetWaiting = new Promise(resolve => { markBudgetWaiting = resolve; });
  const requests = [];
  const child = new FakeAppServer((request, respond, notify) => {
    requests.push(request);
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: threadId } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      if (request.params.objective) goal = { threadId, objective: request.params.objective, status: 'active',
        tokenBudget: 1000, tokensUsed: 120, timeUsedSeconds: 8, createdAt: 'created' };
      else if (Number.isSafeInteger(request.params.tokenBudget)) {
        goal = { ...goal, tokenBudget: request.params.tokenBudget, status: 'active' };
      } else goal = { ...goal, status: request.params.status };
      respond({ id: request.id, result: { goal } });
      emit = notify;
      if (request.params.objective) notify({ method: 'turn/started', params: { threadId, turn: { id: 'auto-first-turn' } } });
      if (Number.isSafeInteger(request.params.tokenBudget)) {
        notify({ method: 'thread/goal/updated', params: { threadId, goal } });
        notify({ method: 'turn/started', params: { threadId, turn: { id: 'auto-budget-turn' } } });
      }
    } else if (request.method === 'turn/interrupt') {
      respond({ id: request.id, result: {} });
      notify({ method: 'turn/completed', params: { threadId,
        turn: { id: 'auto-budget-turn', status: 'interrupted', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 30_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key, workspace, prompt: 'Start auto-activation guard',
    goalRun: { objective: 'Stay stopped after an explicit budget update' },
    onProgress: event => {
      if (event.method === 'turn/started' && event.params?.turn?.id === 'auto-first-turn') markFirstStarted();
      if (event.method === 'bridge/goalStatus' && event.params?.state === 'budgetLimited') markBudgetWaiting();
    } });
  await firstStarted;
  goal = { ...goal, status: 'budgetLimited' };
  emit({ method: 'thread/goal/updated', params: { threadId, goal } });
  emit({ method: 'turn/completed', params: { threadId, turn: { id: 'auto-first-turn', status: 'completed', items: [] } } });
  await budgetWaiting;

  assert.equal(await runner.setGoalBudget(key, 2000, nativeGoalRevision(goal, threadId)), true);
  const result = await resultPromise;
  assert.equal(goal.status, 'paused', 'a native activation caused by the budget write must be stopped');
  assert.equal(goal.tokenBudget, 2000);
  assert.equal(result.goal.status, 'paused');
  assert.equal(requests.some(entry => entry.method === 'turn/start'), false);
  assert.equal(requests.filter(entry => entry.method === 'thread/goal/set' && entry.params.status === 'active').length, 1,
    'the supervisor must not issue a resume mutation during the budget update');
  assert.equal(requests.some(entry => entry.method === 'turn/interrupt'), true);
  assert.equal(runner.isRunning(key), false);
});

test('native Goal context limit accumulates across turns and pauses without claiming completion', async () => {
  let goal = null;
  let emit;
  let markFirstStarted;
  let markFirstWaiting;
  let markSecondStarted;
  let markGuardStopped;
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
  const firstWaiting = new Promise(resolve => { markFirstWaiting = resolve; });
  const secondStarted = new Promise(resolve => { markSecondStarted = resolve; });
  const guardStopped = new Promise(resolve => { markGuardStopped = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'context-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { ...goal, threadId: 'context-goal-thread', objective: 'Stop at the cumulative context limit', status: request.params.status };
      respond({ id: request.id, result: {} });
      emit = notify;
      if (request.params.status === 'active') {
        notify({ method: 'thread/tokenUsage/updated', params: { threadId: 'context-goal-thread', turnId: 'context-turn-1',
          tokenUsage: { total: { inputTokens: 63_000, outputTokens: 100 }, last: { inputTokens: 63_000 } } } });
        notify({ method: 'turn/started', params: { threadId: 'context-goal-thread', turn: { id: 'context-turn-1' } } });
      }
    } else if (request.method === 'turn/interrupt') {
      respond({ id: request.id, result: {} });
      notify({ method: 'turn/completed', params: { threadId: 'context-goal-thread',
        turn: { id: 'context-turn-2', status: 'interrupted', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'cumulative-goal-context', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Stop at the cumulative context limit' },
    onProgress: event => {
      if (event.method === 'turn/started' && event.params.turn?.id === 'context-turn-1') markFirstStarted();
      if (event.method === 'bridge/goalStatus' && event.params.turnsCompleted === 1 && event.params.state === 'waiting') markFirstWaiting();
      if (event.method === 'turn/started' && event.params.turn?.id === 'context-turn-2') markSecondStarted();
      if (event.method === 'bridge/usageGuard' && event.params.action === 'stop') markGuardStopped();
    } });
  await firstStarted;
  emit({ method: 'turn/completed', params: { threadId: 'context-goal-thread',
    turn: { id: 'context-turn-1', status: 'completed', items: [] } } });
  await firstWaiting;
  emit({ method: 'turn/started', params: { threadId: 'context-goal-thread', turn: { id: 'context-turn-2' } } });
  await secondStarted;
  emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'context-goal-thread', turnId: 'context-turn-2',
    tokenUsage: { total: { inputTokens: 64_000, outputTokens: 200 }, last: { inputTokens: 64_000 } } } });
  await guardStopped;
  const result = await resultPromise;
  assert.equal(result.exitCode, 1);
  assert.equal(result.goal.status, 'paused');
  assert.equal(result.usageSummary.stopped, true);
  assert.equal(result.usageSummary.stopReason, 'context-limit');
  assert.equal(result.usageSummary.firstContext, 63_000);
  assert.equal(result.usageSummary.peakContext, 64_000);
});

test('native Goal runtime deadline includes scheduler waiting time after a completed turn', async () => {
  let goal = null;
  let emit;
  let markStarted;
  let markWaiting;
  const started = new Promise(resolve => { markStarted = resolve; });
  const waiting = new Promise(resolve => { markWaiting = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'deadline-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'deadline-goal-thread', objective: 'Honor the Goal-wide runtime deadline', status: request.params.status };
      respond({ id: request.id, result: {} });
      emit = notify;
      if (request.params.status === 'active') notify({ method: 'turn/started', params: {
        threadId: 'deadline-goal-thread', turn: { id: 'deadline-turn-1' }
      } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 400, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'goal-wide-deadline', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Honor the Goal-wide runtime deadline' },
    onProgress: event => {
      if (event.method === 'turn/started' && event.params.turn?.id === 'deadline-turn-1') markStarted();
      if (event.method === 'bridge/goalStatus' && event.params.turnsCompleted === 1 && event.params.state === 'waiting') markWaiting();
    } });
  await started;
  emit({ method: 'turn/completed', params: { threadId: 'deadline-goal-thread',
    turn: { id: 'deadline-turn-1', status: 'completed', items: [] } } });
  await waiting;
  const result = await resultPromise;
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, 1);
  assert.equal(result.goal.status, 'paused');
  assert.equal(result.usageSummary.stopped, false);
});

test('native Goal fails closed if a new turn starts after pause has crossed the stop boundary', async () => {
  let goal = null;
  let emit;
  let markWaiting;
  let markStarted;
  const waiting = new Promise(resolve => { markWaiting = resolve; });
  const started = new Promise(resolve => { markStarted = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'stop-boundary-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'stop-boundary-thread', objective: 'Do not start after pause', status: request.params.status };
      respond({ id: request.id, result: {} });
      emit = notify;
      if (request.params.status === 'active') notify({ method: 'turn/started', params: {
        threadId: 'stop-boundary-thread', turn: { id: 'before-pause' }
      } });
      if (request.params.status === 'paused') {
        notify({ method: 'turn/started', params: { threadId: 'foreign-thread', turn: { id: 'foreign-after-pause' } } });
        notify({ method: 'turn/started', params: {
          threadId: 'stop-boundary-thread', turn: { id: 'after-pause-request' }
        } });
      }
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'goal-stop-boundary', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Do not start after pause' },
    onProgress: event => {
      if (event.method === 'turn/started' && event.params.turn?.id === 'before-pause') markStarted();
      if (event.method === 'bridge/goalStatus' && event.params.state === 'waiting') markWaiting();
    } });
  await started;
  emit({ method: 'turn/completed', params: { threadId: 'stop-boundary-thread',
    turn: { id: 'before-pause', status: 'completed', items: [] } } });
  await waiting;
  const pausePromise = runner.pauseGoal('goal-stop-boundary');
  await assert.rejects(resultPromise, /started a new turn after the stop boundary/);
  await pausePromise.catch(() => {});
  assert.equal(runner.isRunning('goal-stop-boundary'), false);
});

test('native Goal refuses to activate unless start or resume confirms the requested thread policy', async () => {
  const cases = [
    { name: 'model', override: { model: 'unexpected-model' } },
    { name: 'effort', override: { reasoningEffort: 'low' } },
    { name: 'sandbox', override: { sandbox: { type: 'dangerFullAccess' } } },
    { name: 'sandbox roots', override: { sandbox: { type: 'workspaceWrite', writableRoots: ['/extra'] } } },
    { name: 'temporary roots', override: { sandbox: { type: 'workspaceWrite', excludeSlashTmp: true } } },
    { name: 'workspace roots', override: { runtimeWorkspaceRoots: ['/tmp'] } },
    { name: 'incomplete response', raw: true }
  ];
  for (const scenario of cases) {
    let goalSets = 0;
    const child = new FakeAppServer((request, respond) => {
      if (request.method === 'initialize') respond({ id: request.id, result: {} });
      else if (request.method === 'thread/start') {
        assert.equal(request.params.model, 'gpt-6-astra');
        assert.deepEqual(request.params.config, { model_reasoning_effort: 'high' });
        assert.deepEqual(request.params.runtimeWorkspaceRoots, ['/srv/nexus']);
        respond({ id: request.id, result: {
          thread: { id: `policy-${scenario.name.replaceAll(' ', '-')}-thread` }, ...scenario.override
        } });
      }
      else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal: null } });
      else if (request.method === 'thread/goal/set') goalSets++;
    }, { completeThreadResponses: !scenario.raw });
    const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
      planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
    await assert.rejects(runner.execute({ key: `goal-policy-${scenario.name}`, workspace: '/srv/nexus', prompt: 'Start',
      model: 'gpt-6-astra', reasoningEffort: 'high', goalRun: { objective: 'Require exact runtime policy' } }),
    /different or incomplete native Goal thread policy/);
    assert.equal(goalSets, 0, `${scenario.name} mismatch must be rejected before Goal activation`);
  }
});

test('native Goal ignores foreign settings and fails closed if its own thread policy changes', async () => {
  let goal = null;
  let emit;
  let markActive;
  const active = new Promise(resolve => { markActive = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'settings-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'settings-goal-thread', objective: 'Detect thread policy changes', status: request.params.status };
      respond({ id: request.id, result: {} });
      emit = notify;
      if (request.params.status === 'active') notify({ method: 'turn/started', params: {
        threadId: 'settings-goal-thread', turn: { id: 'settings-turn-1' }
      } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'goal-settings-drift', workspace: '/srv/nexus', prompt: 'Start',
    model: 'gpt-6-astra', reasoningEffort: 'high', goalRun: { objective: 'Detect thread policy changes' },
    onProgress: event => { if (event.method === 'bridge/goalStatus' && event.params.turnsSeen === 1) markActive(); } });
  await active;
  emit({ method: 'thread/settings/updated', params: { threadId: 'foreign-thread', threadSettings: {
    model: 'other', effort: 'low', cwd: '/tmp', approvalPolicy: 'never', approvalsReviewer: 'user',
    sandboxPolicy: { type: 'dangerFullAccess' }
  } } });
  assert.equal(runner.isRunning('goal-settings-drift'), true);
  emit({ method: 'thread/settings/updated', params: { threadId: 'settings-goal-thread', threadSettings: {
    model: 'gpt-6-astra', effort: 'high', cwd: '/srv/nexus', approvalPolicy: 'on-request', approvalsReviewer: 'user',
    sandboxPolicy: { type: 'workspaceWrite', networkAccess: false, writableRoots: ['/tmp'] }
  } } });
  await assert.rejects(resultPromise, /thread policy changed while the Goal was active/);
  assert.equal(runner.isRunning('goal-settings-drift'), false);
});

test('native Goal buffers are bounded before an event can be attached to a confirmed turn', async () => {
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'bounded-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal: null } });
    else if (request.method === 'thread/goal/set') {
      respond({ id: request.id, result: {} });
      for (let index = 0; index < 257; index++) notify({ method: 'item/started', params: {
        threadId: 'bounded-goal-thread', turnId: 'unconfirmed-turn',
        item: { id: `item-${index}`, type: 'commandExecution' }
      } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await assert.rejects(runner.execute({ key: 'bounded-goal-buffer', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Bound unconfirmed scheduler events' } }), /Too many unconfirmed native Goal turn events/);
  assert.equal(runner.isRunning('bounded-goal-buffer'), false);
});

test('pre-start Goal usage snapshots preserve peak context and monotonic thread totals', async () => {
  let goal = null;
  let notifyEvents;
  let markTurnStarted;
  const turnStarted = new Promise(resolve => { markTurnStarted = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'monotonic-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'monotonic-goal-thread', objective: request.params.objective, status: 'active' };
      respond({ id: request.id, result: {} });
      notifyEvents = notify;
      notify({ method: 'thread/tokenUsage/updated', params: { threadId: 'monotonic-goal-thread', turnId: 'monotonic-turn',
        tokenUsage: { total: { inputTokens: 65_000, outputTokens: 10 }, last: { inputTokens: 65_000 } } } });
      notify({ method: 'thread/tokenUsage/updated', params: { threadId: 'monotonic-goal-thread', turnId: 'monotonic-turn',
        tokenUsage: { total: { inputTokens: 120, outputTokens: 2 }, last: { inputTokens: 120 } } } });
      notify({ method: 'turn/started', params: { threadId: 'monotonic-goal-thread', turn: { id: 'monotonic-turn' } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, usageGuardMode: 'observe',
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'monotonic-goal-usage', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Preserve pre-start usage maxima' },
    onProgress: event => { if (event.method === 'turn/started' && event.params.turn?.id === 'monotonic-turn') markTurnStarted(); } });
  await turnStarted;
  notifyEvents({ method: 'thread/tokenUsage/updated', params: { threadId: 'monotonic-goal-thread', turnId: 'monotonic-turn',
    tokenUsage: { total: { inputTokens: 90, outputTokens: 1 }, last: { inputTokens: 90 } } } });
  goal = { ...goal, status: 'complete' };
  notifyEvents({ method: 'thread/goal/updated', params: { threadId: 'monotonic-goal-thread', goal } });
  notifyEvents({ method: 'turn/completed', params: { threadId: 'monotonic-goal-thread',
    turn: { id: 'monotonic-turn', status: 'completed', items: [] } } });
  const result = await resultPromise;
  assert.equal(result.usageSummary.peakContext, 65_000);
  assert.equal(result.usageSummary.threadInputTokens, 65_000);
  assert.equal(result.usageSummary.threadOutputTokens, 10);
});

test('Goal pause confirms native state before interrupting the in-flight turn', async () => {
  const events = [];
  let goal = null;
  let markActivated;
  const activated = new Promise(resolve => { markActivated = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'pause-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'pause-goal-thread', objective: request.params.objective ?? goal?.objective,
        status: request.params.status, tokenBudget: null, tokensUsed: 0 };
      events.push(`goal:${goal.status}`);
      respond({ id: request.id, result: { goal } });
      if (goal.status === 'active') {
        notify({ method: 'turn/started', params: { threadId: 'pause-goal-thread', turn: { id: 'pause-turn-1' } } });
      }
    } else if (request.method === 'turn/interrupt') {
      events.push('interrupt');
      respond({ id: request.id, result: {} });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'pause-goal-run', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Wait for pause' },
    onProgress: event => { if (event.method === 'bridge/goalStatus' && event.params.turnsSeen === 1) markActivated(); } });
  await activated;
  const snapshot = await runner.pauseGoal('pause-goal-run');
  assert.equal(snapshot.nativeStatus, 'paused');
  assert.equal(snapshot.state, 'stopping');
  assert.deepEqual(events, ['goal:active', 'goal:paused', 'interrupt']);
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'pause-goal-thread', turn: { id: 'pause-turn-1', status: 'interrupted', items: [] }
  } })}\n`);
  const result = await resultPromise;
  assert.equal(result.exitCode, 1);
  assert.equal(result.goal.status, 'paused');
});

test('Goal cancel fails closed when pause mutation, native read-back, or interrupt fails', async () => {
  const cases = [
    { name: 'pause RPC', failAt: 'pause', error: /pause mutation denied/, expectInterrupt: false },
    { name: 'pause RPC timeout', failAt: 'pause-timeout', error: /Native Goal RPC timed out/, code: 'GOAL_RPC_TIMEOUT', expectInterrupt: false },
    { name: 'pause read-back', failAt: 'readback', error: /Native Goal pause was not confirmed/, expectInterrupt: false },
    { name: 'turn interrupt', failAt: 'interrupt', error: /turn interrupt denied/, expectInterrupt: true }
  ];
  for (const scenario of cases) {
    const events = [];
    let goal = null;
    let markActive;
    const active = new Promise(resolve => { markActive = resolve; });
    const child = new FakeAppServer((request, respond, notify) => {
      if (request.method === 'initialize') respond({ id: request.id, result: {} });
      else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: `cancel-${scenario.failAt}-thread` } } });
      else if (request.method === 'thread/goal/get') {
        events.push('read');
        const resultGoal = scenario.failAt === 'readback' && goal?.status === 'paused'
          ? { ...goal, status: 'active' } : goal;
        respond({ id: request.id, result: { goal: resultGoal } });
      } else if (request.method === 'thread/goal/set') {
        events.push(`goal:${request.params.status}`);
        if (request.params.status === 'paused' && scenario.failAt === 'pause-timeout') return;
        if (request.params.status === 'paused' && scenario.failAt === 'pause') {
          respond({ id: request.id, error: { message: 'pause mutation denied' } });
          return;
        }
        goal = { threadId: `cancel-${scenario.failAt}-thread`, objective: request.params.objective ?? goal?.objective,
          status: request.params.status, tokensUsed: 0 };
        respond({ id: request.id, result: { goal } });
        if (request.params.status === 'active') notify({ method: 'turn/started', params: {
          threadId: goal.threadId, turn: { id: `cancel-${scenario.failAt}-turn` }
        } });
      } else if (request.method === 'turn/interrupt') {
        events.push('interrupt');
        respond(scenario.failAt === 'interrupt'
          ? { id: request.id, error: { message: 'turn interrupt denied' } }
          : { id: request.id, result: {} });
      }
    });
    const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
      planImpl: () => ({ assignments: [] }), maxRuntimeMs: 0, spawnImpl: () => child });
    const key = `cancel-failure-${scenario.failAt}`;
    const workspace = `/srv/cancel-${scenario.failAt}`;
    const resultPromise = runner.execute({ key, workspace, prompt: 'Start',
      goalRun: { objective: 'Pause before releasing the runtime' },
      onProgress: event => { if (event.method === 'turn/started') markActive(); } });
    await active;
    assert.equal(runner.cancel(key), true);
    const timeoutKeepalive = scenario.failAt === 'pause-timeout' ? setTimeout(() => {}, 16_000) : null;
    try {
      await assert.rejects(resultPromise, error => {
        if (scenario.code) assert.equal(error.code, scenario.code);
        return scenario.error.test(error.message);
      });
    }
    finally { if (timeoutKeepalive) clearTimeout(timeoutKeepalive); }
    assert.equal(runner.isRunning(key), false);
    assert.deepEqual(events.filter(event => event === 'interrupt'), scenario.expectInterrupt ? ['interrupt'] : []);
    if (scenario.expectInterrupt) assert.ok(events.indexOf('interrupt') > events.indexOf('goal:paused'));
    const release = acquireRuntimeWriteLease([workspace], { owner: `after-${key}`, lockDirectory: leaseDirectory });
    release();
  }
});

test('invalid native Goal options are rejected before spawning App Server', async () => {
  let spawns = 0;
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => { spawns++; throw new Error('unexpected spawn'); } });
  await assert.rejects(runner.execute({ key: 'invalid-goal-objective', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: '  ' } }), /Goal objective/);
  await assert.rejects(runner.execute({ key: 'invalid-goal-budget', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'valid objective', tokenBudget: 0 } }), /tokenBudget/);
  await assert.rejects(runner.execute({ key: 'inexact-goal-resume', workspace: '/srv/nexus', prompt: 'Resume',
    resumeSessionId: 'saved-goal-thread', goalRun: { resume: true, objective: 'valid objective' } }), /exact thread resume/);
  await assert.rejects(runner.execute({ key: 'goal-resume-without-thread', workspace: '/srv/nexus', prompt: 'Resume',
    goalRun: { resume: true } }), /exact saved thread/);
  await assert.rejects(runner.execute({ key: 'goal-fork-without-recovery', workspace: '/srv/nexus', prompt: 'Resume',
    forkFrom: { threadId: 'source-thread', lastTurnId: 'completed-turn' }, goalRun: { resume: true } }), /explicit fork recovery/);
  await assert.rejects(runner.execute({ key: 'goal-fork-recovery-without-callbacks', workspace: '/srv/nexus', prompt: 'Resume',
    forkFrom: { threadId: 'source-thread', lastTurnId: 'completed-turn' },
    goalRun: { resume: true, forkRecovery: true } }), /explicit validation\/binding callbacks/);
  assert.equal(spawns, 0);
});

test('native Goal resume exact-resumes a paused Goal and lets the native scheduler start the next turn', async () => {
  const events = [];
  let goal = { threadId: 'saved-goal-thread', objective: 'Continue the saved objective', status: 'paused',
    tokenBudget: 7_000, tokensUsed: 1_250 };
  let markActive;
  const active = new Promise(resolve => { markActive = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/resume') {
      events.push('exact-resume');
      assert.equal(request.params.threadId, 'saved-goal-thread');
      assert.deepEqual(request.params.config, { model_reasoning_effort: 'high' });
      assert.deepEqual(request.params.runtimeWorkspaceRoots, ['/srv/nexus']);
      respond({ id: request.id, result: { thread: { id: 'saved-goal-thread' } } });
    } else if (request.method === 'thread/turns/list') respond({ id: request.id, result: { data: [], nextCursor: null } });
    else if (request.method === 'thread/goal/set') {
      events.push(`goal:${request.params.status}`);
      goal = { ...goal, status: request.params.status };
      respond({ id: request.id, result: { goal } });
      if (goal.status === 'active') {
        notify({ method: 'turn/started', params: { threadId: 'saved-goal-thread', turn: { id: 'resumed-turn' } } });
      }
    } else if (request.method === 'turn/start') events.push('client-turn-start');
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'resume-native-goal', workspace: '/srv/nexus', prompt: 'Resume native Goal',
    resumeSessionId: 'saved-goal-thread', resumePolicy: 'exact', reasoningEffort: 'high',
    goalRun: { resume: true, objective: 'Continue the saved objective',
      expectedRevision: nativeGoalRevision(goal, 'saved-goal-thread') },
    onProgress: event => { if (event.method === 'bridge/goalStatus' && event.params.turnsSeen === 1) markActive(); } });
  await active;
  goal = { ...goal, status: 'complete', tokensUsed: 2_000 };
  child.stdout.write(`${JSON.stringify({ method: 'thread/goal/updated', params: { threadId: 'saved-goal-thread', goal } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'saved-goal-thread', turn: { id: 'resumed-turn', status: 'completed', items: [] }
  } })}\n`);
  const result = await resultPromise;
  assert.deepEqual(events, ['exact-resume', 'goal:active']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.goal.turnsCompleted, 1);
});

test('explicit Goal recovery forks the handed-off source, pauses its inherited Goal, and activates only the fork', async () => {
  const events = [];
  const sourceThreadId = 'orphan-source-thread';
  const targetThreadId = 'recovered-goal-thread';
  let goal = { threadId: targetThreadId, objective: 'Continue the saved objective', status: 'active',
    tokenBudget: null, tokensUsed: 56_337, timeUsedSeconds: 75, createdAt: 'created' };
  let notifyServer, markActive;
  const active = new Promise(resolve => { markActive = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/fork') {
      events.push('fork-source');
      assert.equal(request.params.threadId, sourceThreadId);
      assert.equal(request.params.lastTurnId, 'last-completed-turn');
      respond({ id: request.id, result: { thread: { id: targetThreadId } } });
    } else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { ...goal, status: request.params.status };
      events.push(`goal:${goal.status}`);
      respond({ id: request.id, result: { goal } });
      if (goal.status === 'active') {
        notifyServer = notify;
        notify({ method: 'turn/started', params: { threadId: targetThreadId, turn: { id: 'recovered-turn' } } });
      }
    } else if (request.method === 'thread/turns/list') {
      respond({ id: request.id, result: { data: [{ id: 'last-completed-turn' }], nextCursor: null } });
    } else if (request.method === 'turn/start') {
      events.push('client-turn-start');
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'fork-recover-goal', workspace: '/srv/nexus', prompt: 'Resume handed-off Goal',
    forkFrom: { threadId: sourceThreadId, lastTurnId: 'last-completed-turn' }, goalRun: {
      resume: true, objective: 'Continue the saved objective', forkRecovery: true
    },
    onBeforeFork: async () => events.push('source-revalidated'),
    onSessionId: async id => events.push(`bound:${id}`),
    onForkPrepared: async id => { assert.equal(id, targetThreadId); events.push('fork-prepared'); },
    onProgress: event => { if (event.method === 'bridge/goalStatus' && event.params.turnsSeen === 1) markActive(); }
  });
  await active;
  assert.deepEqual(events, ['source-revalidated', 'fork-source', `bound:${targetThreadId}`, 'goal:paused',
    'fork-prepared', 'goal:active']);
  assert.equal(goal.status, 'active');
  goal = { ...goal, status: 'complete', tokensUsed: 56_400 };
  notifyServer({ method: 'thread/goal/updated', params: { threadId: targetThreadId, goal } });
  notifyServer({ method: 'turn/completed', params: { threadId: targetThreadId,
    turn: { id: 'recovered-turn', status: 'completed', items: [] } } });
  const result = await resultPromise;
  assert.equal(result.exitCode, 0);
  assert.equal(result.sessionId, targetThreadId);
  assert.equal(result.goal.status, 'complete');
  assert.equal(events.includes('client-turn-start'), false, 'the native Goal scheduler owns the resumed turn');
});

test('settled budget-limited Goal recovery raises budget under the exact resumed runtime before explicit activation', async () => {
  const calls = [];
  let goal = { threadId: 'settled-budget-thread', objective: 'Continue the saved objective', status: 'budgetLimited',
    tokenBudget: 1200, tokensUsed: 1300, timeUsedSeconds: 31, createdAt: 'created' };
  let notifyServer, markActive;
  const active = new Promise(resolve => { markActive = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/resume') {
      calls.push('exact-resume');
      assert.equal(request.params.threadId, goal.threadId);
      respond({ id: request.id, result: { thread: { id: goal.threadId } } });
      notifyServer = notify;
    } else if (request.method === 'thread/turns/list') respond({ id: request.id, result: {
      data: [{ id: 'previous-process-turn', status: 'completed' }], nextCursor: null
    } });
    else if (request.method === 'thread/goal/set') {
      calls.push(request.params.tokenBudget ? `budget:${request.params.tokenBudget}` : `status:${request.params.status}`);
      goal = { ...goal, ...(request.params.tokenBudget ? { tokenBudget: request.params.tokenBudget } : {}),
        ...(request.params.status ? { status: request.params.status } : {}) };
      respond({ id: request.id, result: { goal } });
      if (request.params.status === 'active') {
        notify({ method: 'turn/started', params: { threadId: goal.threadId,
          turn: { id: 'previous-process-turn', threadId: goal.threadId } } });
        notify({ method: 'turn/started', params: { threadId: goal.threadId,
          turn: { id: 'recovered-turn', threadId: goal.threadId } } });
      }
    } else if (request.method === 'turn/start') calls.push('client-turn-start');
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'recover-settled-budget-goal', workspace: '/srv/nexus',
    prompt: 'Recover this Goal', resumeSessionId: goal.threadId, resumePolicy: 'exact',
    goalRun: { resume: true, resumeBudgetLimited: true, tokenBudget: 2400, objective: goal.objective,
      expectedRevision: nativeGoalRevision(goal, goal.threadId) },
    onProgress: event => { if (event.method === 'bridge/goalStatus' && event.params?.status === 'active') markActive(); } });
  await active;
  assert.deepEqual(calls, ['exact-resume', 'budget:2400', 'status:active']);
  assert.equal(goal.tokensUsed, 1300);
  assert.equal(goal.timeUsedSeconds, 31);
  assert.equal(goal.createdAt, 'created');
  assert.equal(goal.threadId, 'settled-budget-thread');
  assert.ok(notifyServer);
  goal = { ...goal, status: 'complete', tokensUsed: 1500 };
  notifyServer({ method: 'thread/goal/updated', params: { threadId: goal.threadId, goal } });
  notifyServer({ method: 'turn/completed', params: { threadId: goal.threadId,
    turn: { id: 'recovered-turn', status: 'completed', items: [] } } });
  const result = await resultPromise;
  assert.equal(result.exitCode, 0);
  assert.equal(result.goal.turnsSeen, 1, 'a delayed turn from the prior runtime must remain stale');
  assert.equal(result.goal.turnsCompleted, 1);
  assert.equal(calls.includes('client-turn-start'), false, 'the native Goal scheduler owns continuation');
});

test('native Goal recovery ignores a delayed prior-process terminal notification after exact resume', async () => {
  const events = [];
  let goal = { threadId: 'restarted-goal-thread', objective: 'Continue after restart', status: 'paused' };
  let emit;
  let markActive;
  const active = new Promise(resolve => { markActive = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/resume') respond({ id: request.id,
      result: { thread: { id: 'restarted-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/turns/list') respond({ id: request.id, result: {
      data: [{ id: 'prior-process-turn', status: 'completed' }], nextCursor: null
    } });
    else if (request.method === 'thread/goal/set') {
      goal = { ...goal, status: request.params.status };
      respond({ id: request.id, result: { goal } });
      emit = notify;
      if (goal.status === 'active') {
        notify({ method: 'thread/goal/updated', params: { threadId: goal.threadId,
          goal: { ...goal, status: 'complete' } } });
        notify({ method: 'turn/started', params: { threadId: goal.threadId,
          turn: { id: 'prior-process-turn', threadId: goal.threadId } } });
        notify({ method: 'turn/completed', params: { threadId: goal.threadId,
          turn: { id: 'prior-process-turn', threadId: goal.threadId, status: 'completed' } } });
        notify({ method: 'turn/started', params: { threadId: goal.threadId,
          turn: { id: 'new-process-turn', threadId: goal.threadId } } });
      }
    } else if (request.method === 'turn/start') events.push('client-turn-start');
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'restarted-native-goal', workspace: '/srv/nexus', prompt: 'Resume explicitly',
    resumeSessionId: 'restarted-goal-thread', resumePolicy: 'exact',
    goalRun: { resume: true, objective: 'Continue after restart', expectedRevision: nativeGoalRevision(goal, goal.threadId) },
    onProgress: event => { if (event.method === 'bridge/goalStatus' && event.params.turnsSeen === 1) markActive(); } });
  await active;
  assert.equal(runner.isRunning('restarted-native-goal'), true,
    'a stale terminal notification is checked against current native state and cannot settle the resumed run');
  assert.equal(events.includes('client-turn-start'), false);
  emit({ method: 'turn/completed', params: { threadId: goal.threadId,
    turn: { id: 'new-process-turn', threadId: goal.threadId, status: 'completed', items: [] } } });
  await new Promise(resolve => setImmediate(resolve));
  goal = { ...goal, status: 'complete' };
  emit({ method: 'thread/goal/updated', params: { threadId: goal.threadId, goal } });
  const result = await resultPromise;
  assert.equal(result.goal.status, 'complete');
  assert.equal(result.goal.turnsCompleted, 1);
});

test('native Goal execution rejects stale expected revisions before resume or mutation', async () => {
  let resumes = 0;
  let mutations = 0;
  const goal = { threadId: 'stale-goal-thread', objective: 'Existing objective', status: 'paused',
    tokenBudget: 8_000, tokensUsed: 1_000 };
  const child = new FakeAppServer((request, respond) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/resume') resumes++;
    else if (request.method === 'thread/goal/set') mutations++;
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await assert.rejects(runner.execute({ key: 'stale-native-goal', workspace: '/srv/nexus', prompt: 'Resume',
    resumeSessionId: 'stale-goal-thread', resumePolicy: 'exact',
    goalRun: { resume: true, expectedRevision: NO_GOAL_REVISION } }), /Native Goal changed/);
  assert.equal(resumes, 0);
  assert.equal(mutations, 0);
});

test('Goal approval requests and responses stay bound to the exact active thread and turn', async () => {
  let goal = null;
  let emit;
  let markActive;
  let markFirstApproval;
  let markSecondStarted;
  let markSecondApproval;
  let markSecondInput;
  let markTerminalStatus;
  const active = new Promise(resolve => { markActive = resolve; });
  const firstApprovalSeen = new Promise(resolve => { markFirstApproval = resolve; });
  const secondStarted = new Promise(resolve => { markSecondStarted = resolve; });
  const secondApprovalSeen = new Promise(resolve => { markSecondApproval = resolve; });
  const secondInputSeen = new Promise(resolve => { markSecondInput = resolve; });
  const terminalStatusSeen = new Promise(resolve => { markTerminalStatus = resolve; });
  const responses = new Map();
  const responseWaiters = new Map();
  const waitForResponse = id => responses.has(id) ? Promise.resolve(responses.get(id))
    : new Promise(resolve => responseWaiters.set(id, resolve));
  const child = new FakeAppServer((request, respond, notify) => {
    if (!request.method && request.id) {
      const id = String(request.id);
      responses.set(id, request);
      responseWaiters.get(id)?.(request);
      responseWaiters.delete(id);
    } else if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'approval-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'approval-goal-thread', objective: request.params.objective,
        status: request.params.status, tokenBudget: null, tokensUsed: 0 };
      respond({ id: request.id, result: { goal } });
      notify({ method: 'turn/started', params: { threadId: 'approval-goal-thread', turn: { id: 'approval-turn-1' } } });
      emit = notify;
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'scoped-goal-approval', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Handle one approved step' },
    onProgress: event => {
      if (event.method === 'bridge/goalStatus' && event.params.turnsSeen === 1) markActive();
      if (event.method === 'turn/started' && event.params.turn?.id === 'approval-turn-2') markSecondStarted();
      if (event.method === 'bridge/goalStatus' && event.params.status === 'complete') markTerminalStatus();
    },
    onApproval: approval => {
      if (approval.requestId === 'current-approval') {
        assert.equal(runner.approveAll('scoped-goal-approval', approval.requestId), true);
        markFirstApproval();
      } else if (approval.requestId === 'next-turn-approval') markSecondApproval();
    },
    onUserInput: input => { if (input.requestId === 'next-turn-input') markSecondInput(); } });
  await active;
  emit({ id: 'foreign-approval', method: 'item/commandExecution/requestApproval', params: {
    threadId: 'other-thread', turnId: 'approval-turn-1', itemId: 'foreign-item',
    command: './gradlew test', availableDecisions: ['accept', 'decline']
  } });
  const foreignResponse = await waitForResponse('foreign-approval');
  assert.equal(foreignResponse.error.code, -32602);

  emit({ id: 'current-approval', method: 'item/commandExecution/requestApproval', params: {
    threadId: 'approval-goal-thread', turnId: 'approval-turn-1', itemId: 'current-item',
    command: 'rm -rf build', availableDecisions: ['accept', 'decline']
  } });
  await firstApprovalSeen;
  const firstResponse = await waitForResponse('current-approval');
  assert.deepEqual(firstResponse.result, { decision: 'accept' });

  goal = { ...goal, status: 'active' };
  emit({ method: 'turn/completed', params: { threadId: 'approval-goal-thread',
    turn: { id: 'approval-turn-1', status: 'completed', items: [] } } });
  emit({ method: 'turn/started', params: { threadId: 'approval-goal-thread', turn: { id: 'approval-turn-2' } } });
  await secondStarted;
  emit({ id: 'next-turn-approval', method: 'item/commandExecution/requestApproval', params: {
    threadId: 'approval-goal-thread', turnId: 'approval-turn-2', itemId: 'next-item',
    command: 'rm -rf build', availableDecisions: ['accept', 'decline']
  } });
  await secondApprovalSeen;
  emit({ id: 'next-turn-input', method: 'item/tool/requestUserInput', params: { threadId: 'approval-goal-thread',
    turnId: 'approval-turn-2', questions: [{ id: 'choice', header: 'Choice', question: 'Select one',
      options: [{ label: 'A', description: 'Option A' }] }] } });
  await secondInputSeen;
  assert.equal(responses.has('next-turn-approval'), false, 'a prior turn’s approve-all grant must not cross the Goal turn boundary');
  goal = { ...goal, status: 'complete' };
  emit({ method: 'thread/goal/updated', params: { threadId: 'approval-goal-thread', goal } });
  await terminalStatusSeen;
  assert.equal(responses.has('next-turn-approval'), false, 'terminal Goal status must not resolve a pending approval');
  assert.equal(runner.isRunning('scoped-goal-approval'), true, 'terminal Goal status must not settle with an approval and turn pending');
  assert.throws(() => acquireRuntimeWriteLease(['/srv/nexus'], { owner: 'terminal-goal-lease-contender', lockDirectory: leaseDirectory }),
    error => error.code === 'RUNTIME_WRITE_CONFLICT', 'terminal Goal status must not release the workspace lease');
  assert.equal(runner.approve('scoped-goal-approval', 'next-turn-approval', 'decline'), true);
  const secondResponse = await waitForResponse('next-turn-approval');
  assert.deepEqual(secondResponse.result, { decision: 'decline' });
  assert.equal(runner.isRunning('scoped-goal-approval'), true, 'the Goal must remain open while user input and turn completion are pending');

  emit({ method: 'turn/completed', params: { threadId: 'approval-goal-thread',
    turn: { id: 'approval-turn-2', status: 'completed', items: [] } } });
  const result = await resultPromise;
  assert.equal(result.goal.status, 'complete');
  const inputResponse = await waitForResponse('next-turn-input');
  assert.equal(inputResponse.error.code, -32000, 'an unanswered Goal question is rejected when its turn closes');
});

test('same-thread Goal completion without a started active turn fails through recovery', async () => {
  let goal = null;
  let emit;
  let markReady;
  const ready = new Promise(resolve => { markReady = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'out-of-order-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'out-of-order-goal-thread', objective: request.params.objective, status: request.params.status };
      respond({ id: request.id, result: { goal } });
      emit = notify;
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'out-of-order-goal-completion', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Wait for valid turn events' },
    onProgress: event => { if (event.method === 'bridge/goalStatus' && event.params.state === 'waiting') markReady(); } });
  await ready;
  emit({ method: 'turn/completed', params: { threadId: 'out-of-order-goal-thread',
    turn: { id: 'never-started-turn', status: 'completed', items: [] } } });
  await assert.rejects(resultPromise, /Native Goal turn lifecycle became ambiguous/);
  assert.equal(runner.isRunning('out-of-order-goal-completion'), false);
});

test('native Goal read-back must be explicit and disappearance at settlement rejects', async () => {
  let sets = 0;
  const malformedChild = new FakeAppServer((request, respond) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'malformed-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/goal/set') sets++;
  });
  const malformedRunner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => malformedChild });
  await assert.rejects(malformedRunner.execute({ key: 'malformed-goal-read', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Never set after malformed read' } }), /no explicit state/);
  assert.equal(sets, 0);

  const falsyChild = new FakeAppServer((request, respond) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'falsy-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal: false } });
    else if (request.method === 'thread/goal/set') sets++;
  });
  const falsyRunner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => falsyChild });
  await assert.rejects(falsyRunner.execute({ key: 'falsy-goal-read', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Never set after falsy malformed read' } }), /Native Goal state is invalid/);
  assert.equal(sets, 0);

  let goal = null;
  let emit;
  let markActive;
  const active = new Promise(resolve => { markActive = resolve; });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'disappeared-goal-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal } });
    else if (request.method === 'thread/goal/set') {
      goal = { threadId: 'disappeared-goal-thread', objective: request.params.objective,
        status: request.params.status };
      respond({ id: request.id, result: {} });
      emit = notify;
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  const resultPromise = runner.execute({ key: 'disappeared-goal-read', workspace: '/srv/nexus', prompt: 'Start',
    goalRun: { objective: 'Detect external Goal deletion' },
    onProgress: event => {
      if (event.method === 'bridge/goalStatus' && event.params.status === 'active') markActive();
    } });
  await active;
  goal = null;
  emit({ method: 'thread/goal/updated', params: { threadId: 'disappeared-goal-thread', goal: {
    threadId: 'disappeared-goal-thread', objective: 'Detect external Goal deletion', status: 'complete'
  } } });
  await assert.rejects(resultPromise, /Native Goal disappeared/);
  assert.equal(runner.isRunning('disappeared-goal-read'), false);
});

test('a new thread identity is durably accepted before its first turn starts', async () => {
  const events = [];
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') {
      events.push('thread-created');
      respond({ id: request.id, result: { thread: { id: 'owned-thread' } } });
    } else if (request.method === 'turn/start') {
      events.push('turn-start');
      respond({ id: request.id, result: { turn: { id: 'turn-1' } } });
      notify({ method: 'turn/completed', params: { threadId: 'owned-thread', turn: { id: 'turn-1', status: 'completed', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await runner.execute({ key: 'identity-before-turn', workspace: '/srv/nexus', prompt: 'Inspect',
    onSessionId: async id => { events.push(`persist-start:${id}`); await new Promise(resolve => setImmediate(resolve)); events.push('persisted'); } });
  assert.deepEqual(events, ['thread-created', 'persist-start:owned-thread', 'persisted', 'turn-start']);
});

test('fork target ownership and executable binding are persisted before the first turn', async () => {
  const events = [];
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/fork') {
      events.push('fork');
      assert.equal(request.params.threadId, 'source-thread');
      assert.equal(request.params.lastTurnId, 'completed-turn');
      assert.equal(request.params.deferGoalContinuation, true);
      respond({ id: request.id, result: { thread: { id: 'fork-thread' } } });
    } else if (request.method === 'thread/goal/get') {
      events.push(`goal-read:${request.params.threadId}`);
      respond({ id: request.id, result: { goal: { threadId: 'fork-thread', status: 'active' } } });
    } else if (request.method === 'thread/goal/set') {
      events.push(`goal-pause:${request.params.threadId}:${request.params.status}`);
      respond({ id: request.id, result: {} });
    } else if (request.method === 'turn/start') {
      events.push('turn-start');
      assert.equal(request.params.threadId, 'fork-thread');
      respond({ id: request.id, result: { turn: { id: 'turn-1' } } });
      notify({ method: 'turn/completed', params: { threadId: 'fork-thread', turn: { id: 'turn-1', status: 'completed', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await runner.execute({ key: 'fork-before-turn', workspace: '/srv/nexus', prompt: 'Continue',
    forkFrom: { threadId: 'source-thread', lastTurnId: 'completed-turn' },
    onBeforeFork: async source => { events.push(`source-rechecked:${source.threadId}:${source.lastTurnId}`); },
    onSessionId: async id => { events.push(`owner-and-binding:${id}`); await new Promise(resolve => setImmediate(resolve)); events.push('persisted'); },
    onForkPrepared: async id => { events.push(`fork-prepared:${id}`); } });
  assert.deepEqual(events, ['source-rechecked:source-thread:completed-turn', 'fork', 'owner-and-binding:fork-thread', 'persisted', 'goal-read:fork-thread',
    'goal-pause:fork-thread:paused', 'fork-prepared:fork-thread', 'turn-start']);
});

test('source revalidation failure prevents the fork RPC and model turn', async () => {
  let forks = 0, turns = 0;
  const child = new FakeAppServer((request, respond) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/fork') forks++;
    else if (request.method === 'turn/start') turns++;
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await assert.rejects(runner.execute({ key: 'fork-stale-source', workspace: '/srv/nexus', prompt: 'Continue',
    forkFrom: { threadId: 'source-thread', lastTurnId: 'completed-turn' },
    onBeforeFork: async () => { throw new Error('Source changed'); } }), /revalidated immediately before fork/);
  assert.equal(forks, 0);
  assert.equal(turns, 0);
});

test('fork persistence failure does not start a turn or modify the source thread', async () => {
  let turnStarts = 0;
  const child = new FakeAppServer((request, respond) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/fork') respond({ id: request.id, result: { thread: { id: 'orphan-fork' } } });
    else if (request.method === 'turn/start') turnStarts++;
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await assert.rejects(runner.execute({ key: 'fork-persist-failure', workspace: '/srv/nexus', prompt: 'Continue',
    forkFrom: { threadId: 'source-thread', lastTurnId: 'completed-turn' },
    onSessionId: async () => { throw new Error('private persistence detail'); } }), /source conversation was forked.*no model turn was started/);
  assert.equal(turnStarts, 0);
});

test('failure to pause an inherited active Goal prevents the forked turn', async () => {
  let turnStarts = 0;
  const child = new FakeAppServer((request, respond) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/fork') respond({ id: request.id, result: { thread: { id: 'fork-thread' } } });
    else if (request.method === 'thread/goal/get') respond({ id: request.id, result: { goal: { status: 'active' } } });
    else if (request.method === 'thread/goal/set') respond({ id: request.id, error: { message: 'goal mutation denied' } });
    else if (request.method === 'turn/start') turnStarts++;
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await assert.rejects(runner.execute({ key: 'fork-goal-pause-failure', workspace: '/srv/nexus', prompt: 'Continue',
    forkFrom: { threadId: 'source-thread', lastTurnId: 'completed-turn' } }), /safely prepare the forked conversation/);
  assert.equal(turnStarts, 0);
});

test('exact resume rejects a different thread identity without starting a turn', async () => {
  let turnStarts = 0;
  const child = new FakeAppServer((request, respond) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/resume') respond({ id: request.id, result: { thread: { id: 'substituted-thread' } } });
    else if (request.method === 'turn/start') turnStarts++;
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await assert.rejects(runner.execute({ key: 'exact-resume-id', workspace: '/srv/nexus', prompt: 'Continue',
    resumeSessionId: 'bound-thread', resumePolicy: 'exact' }), /different thread for exact resume/);
  assert.equal(turnStarts, 0);
});

test('recovery of a fork with unfinished Goal preparation pauses Goal before exact-resume turn', async () => {
  const events = [];
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/resume') {
      events.push('resume-exact');
      assert.equal(request.params.excludeTurns, true);
      respond({ id: request.id, result: { thread: { id: 'fork-thread' } } });
    } else if (request.method === 'thread/goal/get') {
      events.push('goal-read');
      respond({ id: request.id, result: { goal: { status: 'active' } } });
    } else if (request.method === 'thread/goal/set') {
      events.push('goal-pause');
      respond({ id: request.id, result: {} });
    } else if (request.method === 'turn/start') {
      events.push('turn-start');
      respond({ id: request.id, result: { turn: { id: 'turn-1' } } });
      notify({ method: 'turn/completed', params: { threadId: 'fork-thread', turn: { id: 'turn-1', status: 'completed', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await runner.execute({ key: 'recover-fork-goal', workspace: '/srv/nexus', prompt: 'Continue',
    resumeSessionId: 'fork-thread', resumePolicy: 'exact', prepareForkGoal: true,
    onForkPrepared: async id => events.push(`prepared:${id}`) });
  assert.deepEqual(events, ['resume-exact', 'goal-read', 'goal-pause', 'prepared:fork-thread', 'turn-start']);
});

test('failure to persist a new thread identity prevents the model turn from starting', async () => {
  let turnStarts = 0;
  const child = new FakeAppServer((request, respond) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'unowned-thread' } } });
    else if (request.method === 'turn/start') { turnStarts++; respond({ id: request.id, result: { turn: { id: 'unexpected' } } }); }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime,
    planImpl: () => ({ assignments: [] }), maxRuntimeMs: 5_000, spawnImpl: () => child });
  await assert.rejects(runner.execute({ key: 'identity-write-failure', workspace: '/srv/nexus', prompt: 'Inspect',
    onSessionId: async () => { throw new Error('private disk path must not leak'); } }), /Could not persist the new Codex session binding/);
  assert.equal(turnStarts, 0);
});

test("writing lease remains held until delayed App Server close after a turn failure", async () => {
  let requestedStop;
  const stopRequested = new Promise(resolve => { requestedStop = resolve; });
  const child = new FakeAppServer((request, respond) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/start") respond({ id: request.id, result: { thread: { id: "delayed" } } });
    else if (request.method === "turn/start") respond({ id: request.id, error: { message: "Validation turn failed" } });
  });
  child.kill = () => { child.killed = true; requestedStop(); return true; };
  const common = { leaseDirectory, planImpl: () => ({ assignments: [] }), probeRuntime: fakeRuntime };
  const runner = new CodexRunner({ ...common, spawnImpl: () => child });
  const workspace = "/tmp/delayed-runtime-close";
  const running = runner.execute({ key: "delayed", workspace, prompt: "Fix" });
  const failure = assert.rejects(running, /Validation turn failed/);
  await stopRequested;
  const other = new CodexRunner({ ...common, spawnImpl: () => { throw new Error("Must not spawn during overlap"); } });
  await assert.rejects(other.execute({ key: "other", workspace, prompt: "Fix" }), error => error.code === "RUNTIME_WRITE_CONFLICT");
  child.emit("close", 1, "SIGTERM");
  await failure;
  const afterClose = new CodexRunner({ ...common, probeRuntime: async () => { throw new Error("Lease was released"); } });
  await assert.rejects(afterClose.execute({ key: "after", workspace, prompt: "Fix" }), /Lease was released/);
});

async function fakeRuntime({ threadId } = {}) {
  return { threadRoutingState: threadId ? { query: 'Fix validator', hasImages: false, contextTokens: 20 } : null, models: [{ model: "gpt-6-astra", supportedReasoningEfforts: ["medium", "high"], inputModalities: ["text", "image"] },
    { model: "gpt-5.3-codex-spark", supportedReasoningEfforts: ["medium"], inputModalities: ["text"] }],
    usage: { checkedAt: Date.now(), rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 20 } }, codex_bengalfox: { primary: { usedPercent: 20 } }
    } } };
}

test("live Spark-only policy is identical across resumed thread and turn and cannot be changed by status or steer", async () => {
  const requests = [];
  let finish;
  const child = new FakeAppServer((request, respond, notify) => {
    requests.push(request);
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/resume") respond({ id: request.id, result: { thread: { id: "saved" } } });
    else if (request.method === "turn/start") {
      respond({ id: request.id, result: { turn: { id: "active" } } });
      finish = () => notify({ method: "turn/completed", params: { turn: { status: "completed", items: [] } } });
    }
  });
  let probes = 0;
  const runner = new CodexRunner({ leaseDirectory, maxRuntimeMs: 5000, spawnImpl: () => child,
    planImpl: () => ({ mode: "assisted", assignments: [{ id: "worker:one", role: "worker" }, { id: "reviewer:one", role: "reviewer" }] }),
    probeRuntime: async () => {
      probes++;
      const snapshot = await fakeRuntime({ threadId: 'fixture' });
      snapshot.usage.rateLimitsByLimitId.codex.primary.usedPercent = 100;
      return snapshot;
    }
  });
  const task = runner.execute({ key: "spark", workspace: "/srv/nexus", prompt: "Fix it", model: "gpt-6-astra", resumeSessionId: "saved",
    onModelPolicy: policy => { assert.throws(() => { policy.coordinator.model = "other"; }, TypeError); }
  });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(runner.steer("spark", { prompt: "See image", imageUrls: ["https://example.com/a.png"] }), /Spark-only/);
  const resumed = requests.find(request => request.method === "thread/resume").params;
  const turn = requests.find(request => request.method === "turn/start").params;
  assert.equal(resumed.model, "gpt-5.3-codex-spark");
  assert.equal(turn.model, resumed.model);
  assert.equal(turn.effort, "medium");
  assert.match(resumed.developerInstructions, /"model":"gpt-5.3-codex-spark"/);
  assert.match(resumed.developerInstructions, /fork_turns="none"/);
  assert.equal(requests.some(request => request.method === "turn/steer"), false);
  assert.equal(probes, 1);
  finish();
  await task;
});

test("blocked separate Spark quota prevents any coding process or hidden model fallback", async () => {
  let spawns = 0;
  let decision;
  const runner = new CodexRunner({ leaseDirectory, maxRuntimeMs: 5000, spawnImpl: () => { spawns++; throw new Error("must not launch"); },
    planImpl: () => ({ assignments: [] }), probeRuntime: async () => {
      const snapshot = await fakeRuntime({ threadId: 'fixture' });
      snapshot.usage.rateLimitsByLimitId.codex.primary.usedPercent = 100;
      delete snapshot.usage.rateLimitsByLimitId.codex_bengalfox;
      return snapshot;
    }
  });
  await assert.rejects(runner.execute({ key: "blocked", workspace: "/srv/nexus", prompt: "Fix it", onModelPolicy: value => { decision = value; } }),
    error => error.code === "MODEL_POLICY_BLOCKED" && error.modelPolicy.mode === "blocked");
  assert.equal(decision.mode, "blocked");
  assert.equal(spawns, 0);
  assert.equal(runner.isRunning("blocked"), false);
});

test("quota failure on resumed turn never replays the task in a fresh thread", async () => {
  let started = 0;
  const child = new FakeAppServer((request, respond) => {
    if (request.method === "initialize") respond({ id: request.id, result: {} });
    else if (request.method === "thread/resume") respond({ id: request.id, result: { thread: { id: "saved" } } });
    else if (request.method === "turn/start") respond({ id: request.id, error: { message: "Usage limit exhausted" } });
    else if (request.method === "thread/start") started++;
  });
  const runner = new CodexRunner({ leaseDirectory, maxRuntimeMs: 5000, spawnImpl: () => child, probeRuntime: fakeRuntime, planImpl: () => ({ assignments: [] }) });
  await assert.rejects(runner.execute({ key: "no-replay", workspace: "/srv/nexus", prompt: "Fix", resumeSessionId: "saved" }), /Usage limit/);
  assert.equal(started, 0);
});

test('resumed managed routing retains task risk, images, context and recovery checkpoint before choosing write scope', async () => {
  let plannedQuery, selectedModel, turnPrompt;
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    if (request.method === 'thread/resume') respond({ id: request.id, result: { thread: { id: 'old' } } });
    if (request.method === 'turn/start') {
      selectedModel = request.params.model;
      turnPrompt = request.params.input[0].text;
      respond({ id: request.id, result: { turn: { id: 't' } } });
      notify({ method: 'turn/completed', params: { turn: { status: 'completed', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, spawnImpl: () => child,
    probeRuntime: async args => {
      assert.equal(args.threadId, 'old');
      return { ...await fakeRuntime(), threadRoutingState: { query: 'Review security contracts', hasImages: true, contextTokens: 20000 } };
    }, planImpl: ({ prompt }) => { plannedQuery = prompt; return { contextHints: {}, writeScope: [] }; } });
  const result = await runner.execute({ key: 'resume-routing', workspace: '/tmp', resumeSessionId: 'old', prompt: 'continue',
    resumeCheckpoint: { schemaVersion: 1, id: 'old:turn-1', sessionId: 'old', state: 'stopped',
      branch: 'feature/recovery', head: 'a'.repeat(40), filesChanged: ['src/A.mjs'] } });
  assert.equal(plannedQuery, 'Review security contracts\ncontinue');
  assert.equal(selectedModel, 'gpt-6-astra');
  assert.equal(result.checkpointMutable, true);
  assert.match(turnPrompt, /\"id\":\"old:turn-1\"/);
  assert.match(turnPrompt, /\"freshness\":\"stale\"/);
  assert.doesNotMatch(turnPrompt, /\"branch\":\"feature\/recovery\"|\"filesChanged\":\[\"src\/A.mjs\"\]/);
});

test('an unrelated operational turn does not inherit a saved recovery checkpoint', async () => {
  let turnPrompt;
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    if (request.method === 'thread/resume') respond({ id: request.id, result: { thread: { id: 'old' } } });
    if (request.method === 'turn/start') {
      turnPrompt = request.params.input[0].text;
      respond({ id: request.id, result: { turn: { id: 'status-turn' } } });
      notify({ method: 'turn/completed', params: { turn: { status: 'completed', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, spawnImpl: () => child,
    probeRuntime: async () => ({ ...await fakeRuntime(),
      threadRoutingState: { query: 'Continue TotemLumen renderer work', contextTokens: 20000 } }),
    planImpl: () => ({ contextHints: {}, writeScope: [] }) });
  const result = await runner.execute({ key: 'resume-operational', workspace: '/tmp', resumeSessionId: 'old',
    prompt: 'Show current token usage', resumeCheckpoint: { schemaVersion: 1,
      id: 'old:turn-1', sessionId: 'old', state: 'stopped', branch: 'feature/recovery',
      head: 'a'.repeat(40), filesChanged: ['src/A.mjs'] } });
  assert.doesNotMatch(turnPrompt, /old:turn-1|feature\/recovery|src\/A\.mjs/);
  assert.match(turnPrompt, /\"checkpointRef\":\{\"id\":null/);
  assert.equal(result.checkpointMutable, false);
});

test('compaction telemetry buffers the accepted turn and drops replayed or unscoped events', async () => {
  const forwarded = [];
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    if (request.method === 'thread/resume') respond({ id: request.id, result: { thread: { id: 'old' } } });
    if (request.method === 'turn/start') {
      notify({ method: 'thread/compacted', params: { threadId: 'old', turnId: 'replayed-turn' } });
      notify({ method: 'item/started', params: { threadId: 'old', turnId: 'accepted-turn',
        item: { type: 'contextCompaction' } } });
      notify({ method: 'thread/compacted', params: { threadId: 'old' } });
      respond({ id: request.id, result: { turn: { id: 'accepted-turn' } } });
      notify({ method: 'item/completed', params: { threadId: 'old', turnId: 'accepted-turn',
        item: { id: 'compact-1', type: 'contextCompaction' } } });
      notify({ method: 'item/completed', params: { threadId: 'old', turnId: 'accepted-turn',
        item: { id: 'compact-1', type: 'contextCompaction' } } });
      notify({ method: 'thread/compacted', params: { threadId: 'old', turnId: 'accepted-turn' } });
      notify({ method: 'thread/compacted', params: { threadId: 'old', turnId: 'accepted-turn' } });
      notify({ method: 'turn/completed', params: { threadId: 'old',
        turn: { id: 'accepted-turn', status: 'completed', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, spawnImpl: () => child,
    probeRuntime: async () => ({ ...await fakeRuntime(),
      threadRoutingState: { query: 'Continue work', contextTokens: 20000 } }),
    planImpl: () => ({ contextHints: {}, writeScope: [] }) });
  const result = await runner.execute({ key: 'compaction-scope', workspace: '/tmp',
    resumeSessionId: 'old', prompt: 'continue', onProgress: event => forwarded.push(event) });
  assert.equal(result.telemetry.compaction.observedCount, 2);
  assert.deepEqual(forwarded.filter(event => /compacted|compaction/.test(event.method)
      || (event.method === 'item/completed' && event.params?.item?.type === 'contextCompaction'))
    .map(event => event.params.turnId), ['accepted-turn', 'accepted-turn']);
});

test('usage checkpoints report the effective execution workspace outside progress telemetry', async () => {
  const checkpoints = [];
  const progress = [];
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'checkpoint-thread' } } });
    if (request.method === 'turn/start') {
      respond({ id: request.id, result: { turn: { id: 'checkpoint-turn' } } });
      for (let index = 0; index < 40; index++) notify({ method: 'item/started', params: {
        threadId: 'checkpoint-thread', turnId: 'checkpoint-turn', item: { id: `tool-${index}`, type: 'commandExecution' }
      } });
      notify({ method: 'turn/completed', params: { threadId: 'checkpoint-thread',
        turn: { id: 'checkpoint-turn', status: 'completed', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, spawnImpl: () => child, probeRuntime: fakeRuntime,
    planImpl: () => ({ contextHints: {}, writeScope: [] }), usageGuardMode: 'observe' });
  await runner.execute({ key: 'checkpoint-workspace', workspace: '/tmp', prompt: 'Inspect',
    onUsageCheckpoint: event => checkpoints.push(event), onProgress: event => progress.push(event) });
  assert.equal(checkpoints[0].workspace, '/tmp');
  assert.equal(checkpoints[0].params.action, 'checkpoint');
  assert.ok(progress.some(event => event.method === 'bridge/usageGuard'));
  assert.ok(progress.every(event => !Object.hasOwn(event, 'workspace')));
});

test('unknown continuation cannot invent a managed write scope', async () => {
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: async () => ({ ...await fakeRuntime(), threadRoutingState: null }),
    spawnImpl: () => { throw new Error('Must not start a turn'); } });
  await assert.rejects(runner.execute({ key: 'lost', workspace: '/tmp', resumeSessionId: 'missing', prompt: 'continue' }), /recover the previous task scope/);
  assert.equal(runner.isRunning('lost'), false);
});

test('user questions preserve RPC IDs, reject cross-turn requests and stale answers, and never use approval-all', async () => {
  let runner, presented = 0;
  const questions = [{ id: 'choice', header: 'Choice', question: 'Pick a path', options: [{ label: 'A', description: 'First' }] }];
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'q-thread' } } });
    if (request.method === 'turn/start') {
      respond({ id: request.id, result: { turn: { id: 'q-turn' } } });
      notify({ id: 'foreign', method: 'item/tool/requestUserInput', params: { threadId: 'q-thread', turnId: 'old-turn', questions } });
      notify({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'q-thread', turnId: 'q-turn', itemId: 'cmd', command: 'echo hi', availableDecisions: ['accept', 'decline'] } });
    }
    if (request.id === 'foreign') assert.ok(request.error);
    if (request.id === 'approval') {
      assert.equal(request.result.decision, 'accept');
      notify({ id: '001', method: 'item/tool/requestUserInput', params: { threadId: 'q-thread', turnId: 'q-turn', questions } });
    }
    if (request.id === '001') {
      assert.deepEqual(request.result, { answers: { choice: { answers: ['A'] } } });
      assert.equal(presented, 1);
      assert.equal(runner.answerUserInput('questions', '001', { choice: { answers: ['A'] } }), false);
      notify({ method: 'turn/completed', params: { turn: { status: 'completed', items: [] } } });
    }
  });
  runner = new CodexRunner({ leaseDirectory, spawnImpl: () => child, probeRuntime: fakeRuntime,
    planImpl: () => ({ writeScope: [] }), maxRuntimeMs: 1000 });
  const result = await runner.execute({ key: 'questions', workspace: '/tmp', prompt: 'Inspect',
    onApproval: approval => assert.equal(runner.approveAll('questions', approval.requestId), true),
    onUserInput: input => {
      presented++;
      assert.equal(runner.answerUserInput('wrong-key', input.requestId, {}), false);
      assert.equal(runner.answerUserInput('questions', input.requestId, { wrong: { answers: ['A'] } }), false);
      assert.equal(runner.answerUserInput('questions', input.requestId, { choice: { answers: ['A'] } }), true);
    } });
  assert.equal(result.exitCode, 0);
  assert.equal(runner.answerUserInput('questions', '001', {}), false);
});

test('failed history recovery also blocks an explicit new task on a resumed thread', async () => {
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: async () => ({ ...await fakeRuntime(), threadRoutingState: null }),
    planImpl: () => { throw new Error('Must not plan without capabilities'); },
    spawnImpl: () => { throw new Error('Must not start without history'); } });
  await assert.rejects(runner.execute({ key: 'missing-history', workspace: '/tmp', resumeSessionId: 'old-images',
    prompt: 'Review the README' }), /recover the previous task scope and capabilities/);
  assert.equal(runner.isRunning('missing-history'), false);
});

for (const earlyCurrent of [false, true]) test(`resumed usage is scoped to the accepted turn (current usage before response: ${earlyCurrent})`, async () => {
  let starts = 0, interrupts = 0;
  const progress = [];
  const historical = { last: { inputTokens: 190219 }, total: { inputTokens: 1611515277, outputTokens: 2929080 } };
  const current = { last: { inputTokens: 1200 }, total: { inputTokens: 1611516477, outputTokens: 2929200 } };
  const event = (threadId, turnId, tokenUsage) => ({ method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage } });
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/resume') {
      notify(event('saved', 'previous-turn', historical));
      respond({ id: request.id, result: { thread: { id: 'saved' } } });
    } else if (request.method === 'turn/start') {
      starts++;
      notify(event('saved', 'previous-turn', historical));
      if (earlyCurrent) notify(event('saved', 'current-turn', current));
      respond({ id: request.id, result: { turn: { id: 'current-turn' } } });
      notify(event('other-thread', 'current-turn', historical));
      notify(event('saved', 'previous-turn', historical));
      notify(event('saved', undefined, historical));
      if (!earlyCurrent) notify(event('saved', 'current-turn', current));
      notify({ method: 'turn/completed', params: { turn: { id: 'current-turn', status: 'completed', items: [] } } });
    } else if (request.method === 'turn/interrupt') interrupts++;
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ writeScope: [] }),
    spawnImpl: () => child, maxRuntimeMs: 2000 });
  const result = await runner.execute({ key: `resume-budget-${earlyCurrent}`, workspace: '/tmp', prompt: 'Inspect progress', resumeSessionId: 'saved',
    onProgress: event => progress.push(event) });
  assert.equal(starts, 1); assert.equal(interrupts, 0); assert.equal(result.exitCode, 0);
  assert.equal(result.usageSummary.stopped, false);
  assert.equal(result.usageSummary.observedToolCalls, 0);
  assert.equal(result.usageSummary.firstContext, 1200);
  assert.equal(result.usageSummary.peakContext, 1200);
  assert.equal(result.usageSummary.threadInputTokens, current.total.inputTokens);
  assert.deepEqual(result.usage, current);
  assert.equal(progress.some(event => event.method === 'bridge/usageGuard' && event.params.action === 'stop'), false);
});

test('current usage arriving before turn/start response still enforces the unchanged context limit', async () => {
  let interrupts = 0;
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'thread' } } });
    else if (request.method === 'turn/start') {
      notify({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'current', tokenUsage: {
        last: { inputTokens: 64000 }, total: { inputTokens: 64000, outputTokens: 100 }
      } } });
      respond({ id: request.id, result: { turn: { id: 'current' } } });
    } else if (request.method === 'turn/interrupt') {
      interrupts++; respond({ id: request.id, result: {} });
      notify({ method: 'turn/completed', params: { turn: { id: 'current', status: 'interrupted', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ writeScope: [] }),
    spawnImpl: () => child, maxRuntimeMs: 2000 });
  const result = await runner.execute({ key: 'early-budget', workspace: '/tmp', prompt: 'Inspect' });
  assert.equal(interrupts, 1); assert.equal(result.exitCode, 1);
  assert.equal(result.usageSummary.stopReason, 'context-limit');
  assert.match(result.message, /not an account quota error/);
});

for (const scenario of [
  { name: 'context stop', context: 64000, tools: 0, stopped: true, reason: 'context-limit' },
  { name: 'tool stop', context: 1200, tools: 80, stopped: true, reason: 'tool-limit' },
  { name: 'bounded completion', context: 1200, tools: 1, stopped: false, reason: null }
]) test(`early completion waits for accepted usage: ${scenario.name}`, async () => {
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'thread' } } });
    else if (request.method === 'turn/start') {
      notify({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'old', status: 'completed', items: [] } } });
      notify({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'current', tokenUsage: {
        last: { inputTokens: scenario.context }, total: { inputTokens: scenario.context, outputTokens: 100 }
      } } });
      for (let i = 0; i < 80; i++) notify({ method: 'item/started', params: {
        threadId: 'thread', turnId: 'old', item: { id: `old-${i}`, type: 'mcpToolCall' }
      } });
      for (let i = 0; i < scenario.tools; i++) {
        const event = { method: 'item/started', params: {
          threadId: 'thread', turnId: 'current', item: { id: `tool-${i}`, type: 'mcpToolCall' }
        } };
        notify(event); notify(event);
      }
      notify({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'current', status: 'completed', items: [] } } });
      respond({ id: request.id, result: { turn: { id: 'current' } } });
    } else if (request.method === 'turn/interrupt') respond({ id: request.id, result: {} });
  });
  const runner = new CodexRunner({ leaseDirectory, probeRuntime: fakeRuntime, planImpl: () => ({ writeScope: [] }),
    spawnImpl: () => child, maxRuntimeMs: 2000 });
  const result = await runner.execute({ key: `early-complete-${scenario.name}`, workspace: '/tmp', prompt: 'Inspect' });
  assert.equal(result.exitCode, scenario.stopped ? 1 : 0);
  assert.equal(result.usageSummary.stopped, scenario.stopped);
  assert.equal(result.usageSummary.stopReason, scenario.reason);
  assert.equal(result.usageSummary.peakContext, scenario.context);
  assert.equal(result.usageSummary.observedToolCalls, scenario.tools);
});

for (const resumed of [false, true]) test(`host warning-only mode continues past local thresholds (resumed: ${resumed})`, async () => {
  let interrupts = 0, policyChecked = false;
  const progress = [];
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start' || request.method === 'thread/resume') {
      assert.equal(request.params.approvalPolicy, 'on-request');
      assert.equal(request.params.sandbox, 'workspace-write');
      assert.match(request.params.developerInstructions, /host owner selected warning-only/);
      assert.doesNotMatch(request.params.developerInstructions, /at 80 calls or 64K stop/);
      policyChecked = true;
      respond({ id: request.id, result: { thread: { id: 'terminal-thread' } } });
    } else if (request.method === 'turn/start') {
      assert.equal(request.params.approvalPolicy, 'on-request');
      assert.equal(request.params.sandboxPolicy.type, 'workspaceWrite');
      assert.equal(request.params.sandboxPolicy.networkAccess, false);
      respond({ id: request.id, result: { turn: { id: 'terminal-turn' } } });
      notify({ method: 'thread/tokenUsage/updated', params: { threadId: 'terminal-thread', turnId: 'terminal-turn', tokenUsage: {
        last: { inputTokens: 190219 }, total: { inputTokens: 200000, outputTokens: 1000 }
      } } });
      for (let i = 0; i < 100; i++) notify({ method: 'item/started', params: {
        threadId: 'terminal-thread', turnId: 'terminal-turn', item: { id: `tool-${i}`, type: 'mcpToolCall' }
      } });
      notify({ method: 'turn/completed', params: { threadId: 'terminal-thread', turn: { id: 'terminal-turn', status: 'completed', items: [] } } });
    } else if (request.method === 'turn/interrupt') interrupts++;
  });
  const runner = new CodexRunner({ usageGuardMode: 'observe', maxRuntimeMs: 0, leaseDirectory,
    probeRuntime: fakeRuntime, planImpl: () => ({ waves: [] }), spawnImpl: () => child });
  const result = await runner.execute({ key: `terminal-${resumed}`, workspace: '/tmp', prompt: 'Inspect',
    resumeSessionId: resumed ? 'terminal-thread' : null, onProgress: event => progress.push(event) });
  assert.equal(policyChecked, true); assert.equal(interrupts, 0); assert.equal(result.exitCode, 0);
  assert.equal(result.usageSummary.mode, 'observe'); assert.equal(result.usageSummary.stopped, false);
  assert.equal(result.usageSummary.peakContext, 190219); assert.equal(result.usageSummary.observedToolCalls, 100);
  const checkpoints = progress.filter(event => event.method === 'bridge/usageGuard' && event.params.action === 'checkpoint');
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].params.threadId, 'terminal-thread');
  assert.equal(checkpoints[0].params.turnId, 'terminal-turn');
});

test('warning-only task budgets still honor user cancellation', async () => {
  let runner, interrupts = 0;
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    else if (request.method === 'thread/start') respond({ id: request.id, result: { thread: { id: 'cancel-thread' } } });
    else if (request.method === 'turn/start') {
      respond({ id: request.id, result: { turn: { id: 'cancel-turn' } } });
      assert.equal(runner.cancel('terminal-cancel'), true);
    } else if (request.method === 'turn/interrupt') {
      interrupts++; respond({ id: request.id, result: {} });
      notify({ method: 'turn/completed', params: { threadId: 'cancel-thread', turn: { id: 'cancel-turn', status: 'interrupted', items: [] } } });
    }
  });
  runner = new CodexRunner({ usageGuardMode: 'observe', maxRuntimeMs: 0, leaseDirectory,
    probeRuntime: fakeRuntime, planImpl: () => ({ writeScope: [] }), spawnImpl: () => child });
  const result = await runner.execute({ key: 'terminal-cancel', workspace: '/tmp', prompt: 'Inspect' });
  assert.equal(interrupts, 1); assert.equal(result.exitCode, 1); assert.equal(result.usageSummary.stopped, false);
  assert.match(result.message, /stopped/);
});

test('unknown host budget modes fail closed', () => {
  assert.throws(() => new CodexRunner({ usageGuardMode: 'unlimited' }), /must be enforce or observe/);
});
