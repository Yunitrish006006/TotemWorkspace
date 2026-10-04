import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { approvalResponse, CodexRunner, finalAgentMessage, generatedImagePaths, imageInputs, isAutoApprovedGradleCompile, threadResumeParams, threadStartParams, turnStartParams, turnSteerParams, validateModel, validatePrompt, validateReasoningEffort } from "../src/codex-runner.mjs";
import { taskKey } from "../src/session-store.mjs";

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
  const resumed = threadResumeParams({ threadId: "thread-123", workspace: "/srv/nexus" });
  assert.equal(resumed.cwd, "/srv/nexus");
  assert.equal(resumed.developerInstructions, start.developerInstructions);

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
  assert.equal(result.message, "Fresh session completed.");
  assert.deepEqual(result.imagePaths, ["/tmp/generated.png"]);
  assert.deepEqual(saved, ["fresh-thread"]);
  assert.ok(progress.includes("bridge/sessionReset"));
  assert.equal(requestedReasoningEffort, "high");
  assert.deepEqual(requestedImageUrls, ["https://cdn.discordapp.com/attachments/1/2/screenshot.png"]);
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
  assert.equal(result.message, "Completed without a deadline.");
});

test("one active task key blocks a second Discord thread for the same workspace", async () => {
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
  const firstThreadKey = taskKey({ userId: "user", channelId: "discord-thread-a", workspace: "core" });
  const secondThreadKey = taskKey({ userId: "user", channelId: "discord-thread-b", workspace: "core" });
  const first = runner.execute({ key: firstThreadKey, workspace: "/srv/core", prompt: "Keep working" });

  await turnStarted;
  await assert.rejects(
    runner.execute({ key: secondThreadKey, workspace: "/srv/core", prompt: "Start conflicting work" }),
    /already running/
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
  assert.equal(result.message, "Already done.");
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
  constructor(handleRequest) {
    super();
    this.killed = false;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = {
      destroyed: false,
      write: (line) => {
        const request = JSON.parse(line);
        queueMicrotask(() => handleRequest(request, (response) => this.#send(response), (notification) => this.#send(notification)));
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

test('resumed managed routing retains task risk, images and context before choosing write scope', async () => {
  let plannedQuery, selectedModel;
  const child = new FakeAppServer((request, respond, notify) => {
    if (request.method === 'initialize') respond({ id: request.id, result: {} });
    if (request.method === 'thread/resume') respond({ id: request.id, result: { thread: { id: 'old' } } });
    if (request.method === 'turn/start') {
      selectedModel = request.params.model;
      respond({ id: request.id, result: { turn: { id: 't' } } });
      notify({ method: 'turn/completed', params: { turn: { status: 'completed', items: [] } } });
    }
  });
  const runner = new CodexRunner({ leaseDirectory, spawnImpl: () => child,
    probeRuntime: async args => {
      assert.equal(args.threadId, 'old');
      return { ...await fakeRuntime(), threadRoutingState: { query: 'Review security contracts', hasImages: true, contextTokens: 20000 } };
    }, planImpl: ({ prompt }) => { plannedQuery = prompt; return { contextHints: {}, writeScope: [] }; } });
  await runner.execute({ key: 'resume-routing', workspace: '/tmp', resumeSessionId: 'old', prompt: 'continue' });
  assert.equal(plannedQuery, 'Review security contracts\ncontinue');
  assert.equal(selectedModel, 'gpt-6-astra');
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
  assert.equal(progress.filter(event => event.method === 'bridge/usageGuard' && event.params.action === 'checkpoint').length, 1);
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
