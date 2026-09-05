#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalViewerServer } from "./serve-local-viewer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(ROOT, "scripts", "serve-local-viewer.mjs"), "utf8");
const liveSource = fs.readFileSync(path.join(ROOT, "viewer", "local-live.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "graph-v2.html"), "utf8");

assert.ok(serverSource.includes('const DEFAULT_HOST = "127.0.0.1"'), "local viewer must default to loopback only");
assert.ok(serverSource.includes('host !== DEFAULT_HOST && host !== "::1"'), "non-loopback binds must be rejected");
assert.ok(serverSource.includes('pathname === "/api/workspace-status"'), "workspace-status endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/graph-data"'), "graph-data endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/refresh"'), "refresh endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/viewer-settings"'), "viewer settings endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/activity"'), "agent activity endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/change-intelligence"'), "Phase 3 change-intelligence endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/agent-adapter"'), "Phase 5 agent-adapter endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/orchestration-plan"'), "Phase 7 orchestration-plan endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/replay"'), "Phase 6 replay timeline endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/replay/frame"'), "Phase 6 replay frame endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/verification-state"'), "Phase 4 verification-state endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/prompt"'), "prompt intake endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/conversation"'), "developer conversation endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/conversation/draft"'), "developer draft endpoint is required");
assert.ok(serverSource.includes('pathname === "/api/conversation/prompt"'), "Discord conversation prompt endpoint is required");
assert.ok(serverSource.includes("safeConversationProgress"), "Discord progress must use a whitelist projection");
assert.ok(serverSource.includes('"https://yunitrish006006.github.io"'), "official TotemWorkspace Pages origin must be explicitly allowlisted");
assert.ok(serverSource.includes('"agent-adapter-required"'), "prompt intake must not claim direct agent execution");
assert.ok(serverSource.includes("activity file paths must be repository-relative"), "activity ingestion must reject absolute local file paths");
for (const type of ["command_started", "command_completed", "tool_started", "tool_completed", "agent_message", "usage_updated"]) {
  assert.ok(serverSource.includes(`"${type}"`), `rich Codex activity type missing: ${type}`);
}
assert.ok(serverSource.includes("schemaVersion: 4"), "rich activity payload must use schema v4");
assert.ok(serverSource.includes('const FLUTTER_WEB_ROOT = path.join(ROOT, "viewer_flutter", "build", "web")'), "local bridge must serve the Flutter build by default");
assert.ok(serverSource.includes('decoded === "/legacy" || decoded === "/legacy/"'), "legacy JavaScript viewer must remain mounted under /legacy/");
assert.ok(serverSource.includes("workspaceStatus({ knowledge, reposRoot })"), "status endpoint must reuse workspaceStatus");
assert.ok(serverSource.includes("refreshCodeIndex({"), "refresh endpoint must reuse incremental code-index refresh");
assert.ok(serverSource.includes("renderGraphV2({ knowledge, index: refreshed.index })"), "refresh endpoint must regenerate graph data");
assert.ok(serverSource.includes("setTimeout(flushLiveRefresh, 850)"), "Codex edits must debounce module-scoped live semantic refresh");
assert.ok(serverSource.includes("mapGitChangesToSemantic(["), "live file edits must reuse Phase 3 semantic file mapping");
assert.ok(serverSource.includes("componentId: event.componentId ?? (mapped?.componentIds?.length === 1 ? mapped.componentIds[0] : null)"), "live file edits must enrich known component coordinates");
assert.ok(serverSource.includes("featureId: event.featureId ?? (mapped?.featureIds?.length === 1 ? mapped.featureIds[0] : null)"), "live file edits must enrich known feature coordinates");
assert.ok(serverSource.includes("moduleId: changedModuleIds.length === 1 ? changedModuleIds[0] : null"), "incremental graph refresh must preserve module fallback activity coordinates");
assert.ok(serverSource.includes("componentId: changedComponentIds.length === 1 ? changedComponentIds[0] : null"), "incremental graph refresh must expose a unique refreshed component when available");
assert.ok(serverSource.includes("prepareApiCors(req, res)"), "Flutter dev access must pass through loopback-only CORS validation");
assert.ok(serverSource.includes("approved TotemWorkspace or loopback clients"), "browser CORS must be restricted to approved Pages or loopback origins");
assert.ok(!serverSource.includes('const DEFAULT_HOST = "0.0.0.0"'), "local viewer must not expose LAN by default");

assert.ok(html.includes('id="liveLocal"'), "viewer must expose LIVE LOCAL badge");
assert.ok(html.includes('id="localStatus"'), "viewer must expose local status button");
assert.ok(html.includes('id="refreshLocal"'), "viewer must expose local refresh button");
assert.ok(html.includes('<script src="viewer/local-live.js"></script>'), "viewer must load the local-live adapter");
assert.ok(html.includes("connect-src 'self' http://127.0.0.1:18765"), "legacy CSP must permit the loopback bridge");
assert.ok(liveSource.includes('apiUrl("/api/workspace-status")'), "legacy local adapter must poll workspace status through the local bridge base");
assert.ok(liveSource.includes("A graph pulse denotes an executing task"), "legacy activity pulse must not persist after an agent task completes");
assert.ok(liveSource.includes('apiUrl("/api/refresh")'), "legacy local adapter must trigger index refresh through the local bridge base");
assert.ok(liveSource.includes('apiUrl("/api/viewer-settings")'), "legacy viewer must use shared local viewer settings");
assert.ok(liveSource.includes('apiUrl("/api/activity?after="'), "legacy viewer must poll shared agent activity");
assert.ok(liveSource.includes('apiUrl("/api/verification-state")'), "legacy viewer must poll shared verification state");
assert.ok(liveSource.includes('apiUrl("/api/prompt")'), "legacy prompt surface must submit through the bridge");
assert.ok(liveSource.includes('apiUrl("/api/replay")'), "legacy viewer must poll durable replay timeline");
assert.ok(liveSource.includes('apiUrl("/api/replay/frame?sequence="'), "legacy viewer must load historical replay frames");
assert.ok(liveSource.includes('host === "yunitrish006006.github.io"'), "legacy Pages must discover the loopback bridge");
assert.ok(liveSource.includes("window.setInterval(poll, 5000)"), "local status must refresh periodically");
assert.ok(liveSource.includes("window.location.reload()"), "successful local refresh must reload regenerated graph data");

const settingsPath = path.join(ROOT, ".totem-index", "viewer-settings.json");
const settingsBackup = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : null;
if (fs.existsSync(settingsPath)) fs.rmSync(settingsPath);

const verificationPath = path.join(ROOT, ".totem-index", "verification-state.json");
const verificationBackup = fs.existsSync(verificationPath) ? fs.readFileSync(verificationPath) : null;
if (fs.existsSync(verificationPath)) fs.rmSync(verificationPath);

const replayPath = path.join(ROOT, ".totem-index", "development-replay.json");
const replayBackup = fs.existsSync(replayPath) ? fs.readFileSync(replayPath) : null;
if (fs.existsSync(replayPath)) fs.rmSync(replayPath);

const flutterFixture = fs.mkdtempSync(path.join(os.tmpdir(), "totem-flutter-root-"));
fs.writeFileSync(path.join(flutterFixture, "index.html"), "<!doctype html><title>TOTEM Flutter fixture</title><script src=\"main.dart.js\"></script>", "utf8");
fs.writeFileSync(path.join(flutterFixture, "main.dart.js"), "window.__TOTEM_FLUTTER_FIXTURE__ = true;", "utf8");
fs.writeFileSync(path.join(flutterFixture, "main.dart.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

const dispatchedPrompts = [];
const fakeAgentAdapter = {
  status() {
    return {
      schemaVersion: 1,
      kind: "codex",
      configured: true,
      available: true,
      busy: false,
      version: "codex-cli fixture",
      sandbox: "workspace-write",
      model: null,
      reason: null,
      currentTask: null,
      lastTask: null
    };
  },
  dispatch(request) {
    dispatchedPrompts.push(request);
    return {
      schemaVersion: 1,
      id: "task:http-fixture:1",
      adapter: "codex",
      state: "running",
      moduleId: request.moduleId ?? null,
      featureId: request.featureId ?? null,
      threadId: null,
      startedAt: "now",
      completedAt: null,
      summary: request.summary ?? null,
      error: null
    };
  },
  close() {}
};
const syncToken = "test-conversation-sync-token";
const server = createLocalViewerServer({
  flutterRoot: flutterFixture,
  agentAdapter: fakeAgentAdapter,
  agentEnv: { ...process.env, TOTEM_CONVERSATION_SYNC_TOKEN: syncToken }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === "object", "ephemeral local server must expose its address");
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const healthPayload = await health.json();
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.mode, "local");
  assert.equal(healthPayload.activitySchemaVersion, 3);
  assert.equal(healthPayload.verificationSchemaVersion, 1);
  assert.equal(healthPayload.replaySchemaVersion, 1);
  assert.equal(healthPayload.orchestrationSchemaVersion, 1);
  assert.equal(healthPayload.agentAdapterSchemaVersion, 1);
  assert.equal(healthPayload.promptExecution, "codex");
  assert.equal(healthPayload.agentAdapter.available, true);

  const flutterHealth = await fetch(`${base}/api/health`, {
    headers: { Origin: "http://localhost:54321" }
  });
  assert.equal(flutterHealth.status, 200);
  assert.equal(flutterHealth.headers.get("access-control-allow-origin"), "http://localhost:54321");
  assert.match(flutterHealth.headers.get("access-control-allow-methods") ?? "", /POST/);

  const pagesHealth = await fetch(`${base}/api/health`, {
    headers: { Origin: "https://yunitrish006006.github.io" }
  });
  assert.equal(pagesHealth.status, 200);
  assert.equal(
    pagesHealth.headers.get("access-control-allow-origin"),
    "https://yunitrish006006.github.io",
    "published TotemWorkspace Pages must be able to reach the loopback bridge"
  );

  const adapterStatus = await fetch(`${base}/api/agent-adapter`);
  assert.equal(adapterStatus.status, 200);
  const adapterPayload = await adapterStatus.json();
  assert.equal(adapterPayload.kind, "codex");
  assert.equal(adapterPayload.available, true);

  const planned = await fetch(`${base}/api/orchestration-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "inspect TotemAutomata gathering outline", moduleId: "totem-automata" })
  });
  assert.equal(planned.status, 200);
  const plannedPayload = await planned.json();
  assert.equal(plannedPayload.schemaVersion, 1);
  assert.ok(["primary-only", "assisted", "bounded-parallel", "guarded-parallel"].includes(plannedPayload.mode));
  assert.ok(plannedPayload.assignments.length <= 4);

  const preflight = await fetch(`${base}/api/refresh`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:54321",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Private-Network": "true"
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:54321");
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

  const blocked = await fetch(`${base}/api/health`, {
    headers: { Origin: "https://example.com" }
  });
  assert.equal(blocked.status, 403);

  const defaults = await fetch(`${base}/api/viewer-settings`);
  assert.equal(defaults.status, 200);
  const defaultSettings = await defaults.json();
  assert.equal(defaultSettings.promptEnabled, false, "Prompt must default to OFF");
  assert.equal(defaultSettings.agentActivityEnabled, true, "Agent Activity must remain independent of Prompt");

  const blockedPrompt = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "do not execute this" })
  });
  assert.equal(blockedPrompt.status, 403, "Prompt submission must be rejected while Prompt is disabled");

  const enablePrompt = await fetch(`${base}/api/viewer-settings`, {
    method: "POST",
    headers: {
      Origin: "https://yunitrish006006.github.io",
      "content-type": "application/json"
    },
    body: JSON.stringify({ promptEnabled: true })
  });
  assert.equal(enablePrompt.status, 200);
  assert.equal((await enablePrompt.json()).promptEnabled, true);

  const pagesConversation = await fetch(`${base}/api/conversation`, {
    headers: { Origin: "https://yunitrish006006.github.io" }
  });
  assert.equal(pagesConversation.status, 403, "published Pages must not receive private prompt transcript data");

  const draft = await fetch(`${base}/api/conversation/draft`, {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:54321", "content-type": "application/json" },
    body: JSON.stringify({ clientId: "viewer:fixture", text: "draft stays in loopback conversation memory" })
  });
  assert.equal(draft.status, 202);

  const localConversation = await fetch(`${base}/api/conversation`, {
    headers: { Origin: "http://127.0.0.1:54321" }
  });
  assert.equal(localConversation.status, 200);
  assert.equal((await localConversation.json()).draft.text, "draft stays in loopback conversation memory");

  const prompt = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: {
      Origin: "https://yunitrish006006.github.io",
      "content-type": "application/json"
    },
    body: JSON.stringify({ prompt: "inspect TotemAutomata gathering outline" })
  });
  assert.equal(prompt.status, 202);
  const promptPayload = await prompt.json();
  assert.equal(promptPayload.execution, "codex");
  assert.equal(promptPayload.event.type, "prompt_submitted");
  assert.equal(promptPayload.task.id, "task:http-fixture:1");
  assert.equal(promptPayload.orchestration.schemaVersion, 1);
  assert.ok(promptPayload.orchestration.score >= 0);
  assert.equal(dispatchedPrompts.length, 1);
  assert.equal(dispatchedPrompts[0].prompt, "inspect TotemAutomata gathering outline");
  assert.equal(dispatchedPrompts[0].orchestrationPlan.schemaVersion, 1);

  const transcript = await fetch(`${base}/api/conversation`, {
    headers: { Origin: "http://127.0.0.1:54321" }
  });
  const transcriptPayload = await transcript.json();
  assert.ok(transcriptPayload.entries.some((entry) =>
    entry.source === "viewer" && entry.kind === "prompt" && entry.text === "inspect TotemAutomata gathering outline"
  ), "full viewer prompt must stay in the private conversation transcript");

  const syncedPrompt = await fetch(`${base}/api/conversation/prompt`, {
    method: "POST",
    headers: { authorization: `Bearer ${syncToken}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: "inspect the shared developer tools", clientMessageId: "discord-fixture:1" })
  });
  assert.equal(syncedPrompt.status, 202);
  assert.equal((await syncedPrompt.json()).execution, "codex");
  assert.equal(dispatchedPrompts.length, 2, "Discord must reuse the same Workspace adapter");

  const duplicateSyncedPrompt = await fetch(`${base}/api/conversation/prompt`, {
    method: "POST",
    headers: { authorization: `Bearer ${syncToken}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: "inspect the shared developer tools", clientMessageId: "discord-fixture:1" })
  });
  assert.equal(duplicateSyncedPrompt.status, 202);
  assert.equal((await duplicateSyncedPrompt.json()).execution, "duplicate");
  assert.equal(dispatchedPrompts.length, 2, "retrying a Discord message must not dispatch a second task");

  const unauthorizedSyncedPrompt = await fetch(`${base}/api/conversation/prompt`, {
    method: "POST",
    headers: { authorization: "Bearer incorrect", "content-type": "application/json" },
    body: JSON.stringify({ prompt: "must not run", clientMessageId: "discord-fixture:2" })
  });
  assert.equal(unauthorizedSyncedPrompt.status, 401);

  const syncedStatus = await fetch(`${base}/api/conversation/status`, {
    headers: { authorization: `Bearer ${syncToken}` }
  });
  assert.equal(syncedStatus.status, 200);
  assert.equal((await syncedStatus.json()).available, true);

  const idleCancel = await fetch(`${base}/api/conversation/cancel`, {
    method: "POST",
    headers: { authorization: `Bearer ${syncToken}`, "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(idleCancel.status, 200);
  assert.equal((await idleCancel.json()).status, "idle");

  const activityPost = await fetch(`${base}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "file_edit",
      moduleId: "totem-automata",
      featureId: "totem-automata.feature-4",
      file: "src/client/java/dev/totem/automata/client/CopperGolemVisualizationClient.java",
      summary: "editing outline rendering"
    })
  });
  assert.equal(activityPost.status, 202);
  const editEvent = (await activityPost.json()).event;
  assert.equal(editEvent.type, "file_edit");
  assert.equal(editEvent.moduleId, "totem-automata");

  const consoleEventPost = await fetch(`${base}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "command_completed",
      taskId: "task:console-fixture",
      moduleId: "totem-automata",
      command: "./gradlew test",
      status: "success",
      summary: "Command completed · ./gradlew test",
      detail: "BUILD SUCCESSFUL",
      usage: {
        inputTokens: 120,
        cachedInputTokens: 80,
        cacheWriteInputTokens: 0,
        outputTokens: 20,
        reasoningOutputTokens: 4,
        totalTokens: 140
      }
    })
  });
  assert.equal(consoleEventPost.status, 202);
  const consoleEvent = (await consoleEventPost.json()).event;
  assert.equal(consoleEvent.command, "./gradlew test");
  assert.equal(consoleEvent.detail, "BUILD SUCCESSFUL");
  assert.equal(consoleEvent.usage.totalTokens, 140);

  const activity = await fetch(`${base}/api/activity?after=0`);
  assert.equal(activity.status, 200);
  const activityPayload = await activity.json();
  assert.equal(activityPayload.schemaVersion, 4);
  assert.ok(activityPayload.latestSequence >= 3);
  assert.ok(activityPayload.events.some((event) =>
    event.type === "command_completed" &&
    event.taskId === "task:console-fixture" &&
    event.detail === "BUILD SUCCESSFUL" &&
    event.usage?.totalTokens === 140
  ), "rich Codex console event fields must survive activity persistence");

  const testTarget = "test:totem-core:src/test/java/example/BridgeFixtureTest.java";
  const testStarted = await fetch(`${base}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "test_started",
      moduleId: "totem-core",
      test: testTarget,
      summary: "bridge fixture test started"
    })
  });
  assert.equal(testStarted.status, 202);
  const startedEvent = (await testStarted.json()).event;

  const runningVerification = await fetch(`${base}/api/verification-state`);
  assert.equal(runningVerification.status, 200);
  const runningPayload = await runningVerification.json();
  assert.equal(runningPayload.summary.running, 1);
  assert.equal(runningPayload.summary.failed, 0);
  assert.equal(runningPayload.entries.at(-1).target, testTarget);
  assert.equal(runningPayload.entries.at(-1).status, "running");

  const testFailed = await fetch(`${base}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "test_failed",
      moduleId: "totem-core",
      test: testTarget,
      summary: "bridge fixture test failed"
    })
  });
  assert.equal(testFailed.status, 202);
  const failedEvent = (await testFailed.json()).event;

  const failedVerification = await fetch(`${base}/api/verification-state`);
  assert.equal(failedVerification.status, 200);
  const failedPayload = await failedVerification.json();
  assert.equal(failedPayload.summary.running, 0, "latest state must replace older running state");
  assert.equal(failedPayload.summary.failed, 1);
  const fixtureEntries = failedPayload.entries.filter((entry) => entry.target === testTarget);
  assert.equal(fixtureEntries.length, 1, "same test target must have one latest verification state");
  assert.equal(fixtureEntries[0].status, "failed");

  const replayTimeline = await fetch(`${base}/api/replay`);
  assert.equal(replayTimeline.status, 200);
  const replayTimelinePayload = await replayTimeline.json();
  assert.equal(replayTimelinePayload.schemaVersion, 1);
  assert.ok(replayTimelinePayload.eventCount >= 4);
  assert.ok(replayTimelinePayload.latestSequence >= failedEvent.sequence);

  const runningFrameResponse = await fetch(
    `${base}/api/replay/frame?sequence=${encodeURIComponent(startedEvent.sequence)}`
  );
  assert.equal(runningFrameResponse.status, 200);
  const runningFrame = await runningFrameResponse.json();
  assert.equal(runningFrame.sequence, startedEvent.sequence);
  assert.equal(runningFrame.live, false);
  assert.equal(runningFrame.verificationState.summary.running, 1);
  assert.equal(runningFrame.verificationState.summary.failed, 0);

  const failedFrameResponse = await fetch(
    `${base}/api/replay/frame?sequence=${encodeURIComponent(failedEvent.sequence)}`
  );
  assert.equal(failedFrameResponse.status, 200);
  const failedFrame = await failedFrameResponse.json();
  assert.equal(failedFrame.verificationState.summary.running, 0);
  assert.equal(failedFrame.verificationState.summary.failed, 1);

  const milestonePost = await fetch(`${base}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "commit_created",
      moduleId: "totem-core",
      summary: "abcdef12 replay milestone"
    })
  });
  assert.equal(milestonePost.status, 202);

  const milestoneTimeline = await fetch(`${base}/api/replay`);
  const milestonePayload = await milestoneTimeline.json();
  assert.equal(milestonePayload.milestones.at(-1).type, "commit_created");

  const absolutePathEvent = await fetch(`${base}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "file_read", file: ["", "Users", "example", "private.java"].join("/") })
  });
  assert.equal(absolutePathEvent.status, 400, "absolute local paths must be rejected rather than stored");

  const absoluteTestEvent = await fetch(`${base}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "test_failed",
      moduleId: "totem-core",
      test: ["/home", "thomas", "workspace", "TotemCore", "src", "test", "PrivateTest.java"].join("/")
    })
  });
  assert.equal(absoluteTestEvent.status, 400, "verification test targets must not expose absolute local paths");

  const status = await fetch(`${base}/api/workspace-status`);
  assert.equal(status.status, 200);
  const payload = await status.json();
  assert.equal(payload.mode, "local");
  assert.equal(payload.modules.length, 11);
  assert.ok(payload.modules.every((entry) => !Object.hasOwn(entry, "path")), "browser API must not expose absolute local repo paths");
  assert.ok(payload.modules.every((entry) => entry.locales?.ja_jp), "workspace status must report Japanese localization coverage");
  assert.ok(payload.modules.every((entry) => typeof entry.locales.ja_jp.complete === "boolean"), "Japanese localization coverage must report completion state");
  const japaneseModules = payload.modules.filter((entry) => entry.present && entry.locales.ja_jp.applicable);
  assert.equal(japaneseModules.length, 10, "all localized Totem modules except the language-free Discord bridge must report Japanese coverage");
  assert.ok(japaneseModules.every((entry) => entry.locales.ja_jp.complete), "Japanese locale coverage must be complete for every localized module");
  assert.equal(
    japaneseModules.reduce((sum, entry) => sum + entry.locales.ja_jp.sourceKeys, 0),
    1365,
    "Japanese coverage must account for every current English language key"
  );

  const flutterRoot = await fetch(`${base}/`);
  assert.equal(flutterRoot.status, 200);
  assert.equal(flutterRoot.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(flutterRoot.headers.get("cross-origin-embedder-policy"), "credentialless");
  assert.match(await flutterRoot.text(), /TOTEM Flutter fixture/, "local bridge root must serve Flutter");

  const flutterAsset = await fetch(`${base}/main.dart.js`);
  assert.equal(flutterAsset.status, 200);
  assert.match(await flutterAsset.text(), /TOTEM_FLUTTER_FIXTURE/, "Flutter assets must be served from the local build root");

  const flutterWasm = await fetch(`${base}/main.dart.wasm`);
  assert.equal(flutterWasm.status, 200);
  assert.equal(
    flutterWasm.headers.get("content-type"),
    "application/wasm",
    "Flutter Wasm must be served with application/wasm under nosniff"
  );

  const legacyPage = await fetch(`${base}/legacy/`);
  assert.equal(legacyPage.status, 200);
  assert.ok((await legacyPage.text()).includes("viewer/local-live.js"), "legacy viewer must remain available under /legacy/");

  const compatibilityPage = await fetch(`${base}/graph-v2.html`);
  assert.equal(compatibilityPage.status, 200);
  assert.ok((await compatibilityPage.text()).includes("viewer/local-live.js"));
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(flutterFixture, { recursive: true, force: true });
  if (settingsBackup == null) {
    if (fs.existsSync(settingsPath)) fs.rmSync(settingsPath);
  } else {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, settingsBackup);
  }
  if (verificationBackup == null) {
    if (fs.existsSync(verificationPath)) fs.rmSync(verificationPath);
  } else {
    fs.mkdirSync(path.dirname(verificationPath), { recursive: true });
    fs.writeFileSync(verificationPath, verificationBackup);
  }
  if (replayBackup == null) {
    if (fs.existsSync(replayPath)) fs.rmSync(replayPath);
  } else {
    fs.mkdirSync(path.dirname(replayPath), { recursive: true });
    fs.writeFileSync(replayPath, replayBackup);
  }
}

console.log("Local live viewer validation passed: Flutter owns /, legacy JS stays under /legacy/, and loopback-only API/settings/activity/change/verification/agent-dispatch/replay/refresh behavior remains intact.");
