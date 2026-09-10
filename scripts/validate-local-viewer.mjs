#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalViewerServer } from "./serve-local-viewer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(ROOT, "scripts", "serve-local-viewer.mjs"), "utf8");

assert.ok(serverSource.includes('const DEFAULT_HOST = "127.0.0.1"'), "local viewer must default to loopback only");
assert.ok(serverSource.includes('host !== DEFAULT_HOST && host !== "::1"'), "non-loopback binds must be rejected");
for (const endpoint of [
  "/api/health",
  "/api/workspace-status",
  "/api/graph-data",
  "/api/refresh",
  "/api/viewer-settings",
  "/api/activity",
  "/api/change-intelligence",
  "/api/agent-adapter",
  "/api/orchestration-plan",
  "/api/replay",
  "/api/replay/frame",
  "/api/verification-state",
  "/api/prompt",
  "/api/conversation",
  "/api/conversation/draft",
  "/api/conversation/prompt",
]) {
  assert.ok(serverSource.includes(endpoint), `local bridge is missing ${endpoint}`);
}
assert.ok(serverSource.includes("safeConversationProgress"), "Discord progress must use a whitelist projection");
assert.ok(serverSource.includes('"https://yunitrish006006.github.io"'), "official TotemWorkspace Pages origin must be explicitly allowlisted");
assert.ok(serverSource.includes('"agent-adapter-required"'), "prompt intake must remain adapter-gated");
assert.ok(serverSource.includes("activity file paths must be repository-relative"), "activity ingestion must reject absolute local file paths");
assert.ok(serverSource.includes('const FLUTTER_WEB_ROOT = path.join(ROOT, "viewer_flutter", "build", "web")'), "local bridge must serve the Flutter build by default");
assert.ok(serverSource.includes("workspaceStatus({ knowledge, reposRoot })"), "status endpoint must reuse workspaceStatus");
assert.ok(serverSource.includes("refreshCodeIndex({"), "refresh endpoint must reuse incremental code-index refresh");
assert.ok(serverSource.includes("renderGraphV2({ knowledge, index: refreshed.index })"), "refresh endpoint must regenerate the Flutter graph asset through the compatibility entry point");
assert.ok(serverSource.includes("setTimeout(flushLiveRefresh, 850)"), "Codex edits must debounce module-scoped live semantic refresh");
assert.ok(serverSource.includes("mapGitChangesToSemantic(["), "live file edits must reuse Phase 3 semantic file mapping");
assert.ok(serverSource.includes("prepareApiCors(req, res)"), "Flutter web access must pass through restricted CORS validation");
assert.ok(serverSource.includes("approved TotemWorkspace or loopback clients"), "browser CORS must be restricted to approved Pages or loopback origins");
assert.ok(!serverSource.includes('const DEFAULT_HOST = "0.0.0.0"'), "local viewer must not expose LAN by default");
assert.ok(!serverSource.includes('node:child_process'), "browser prompt intake must not gain direct shell execution");

for (const removed of [
  "graph-v2.html",
  "viewer/graph-v2.css",
  "viewer/graph-v2-adapter.js",
  "viewer/graph-v2-cluster.js",
  "viewer/graph-v2-cluster-v2.js",
  "viewer/local-live.js",
  "viewer/generated/graph-data.js",
]) {
  assert.equal(fs.existsSync(path.join(ROOT, removed)), false, `legacy browser viewer artifact must stay removed: ${removed}`);
}

const statePaths = [
  path.join(ROOT, ".totem-index", "viewer-settings.json"),
  path.join(ROOT, ".totem-index", "verification-state.json"),
  path.join(ROOT, ".totem-index", "development-replay.json"),
];
const backups = new Map(statePaths.map((filePath) => [filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath) : null]));
for (const filePath of statePaths) {
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}

const flutterFixture = fs.mkdtempSync(path.join(os.tmpdir(), "totem-flutter-root-"));
fs.writeFileSync(path.join(flutterFixture, "index.html"), "<!doctype html><title>TOTEM Flutter fixture</title><script src=\"main.dart.js\"></script>", "utf8");
fs.writeFileSync(path.join(flutterFixture, "main.dart.js"), "window.__TOTEM_FLUTTER_FIXTURE__ = true;", "utf8");
fs.writeFileSync(path.join(flutterFixture, "main.dart.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

const dispatchedPrompts = [];
const fakeAgentAdapter = {
  async refreshCapabilities() {},
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
      lastTask: null,
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
      error: null,
    };
  },
  close() {},
};

const server = createLocalViewerServer({
  flutterRoot: flutterFixture,
  agentAdapter: fakeAgentAdapter,
  agentEnv: { ...process.env, TOTEM_CONVERSATION_SYNC_TOKEN: "test-conversation-sync-token" },
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === "object", "ephemeral local server must expose its address");
  const base = `http://127.0.0.1:${address.port}`;

  const root = await fetch(`${base}/`);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /TOTEM Flutter fixture/);
  const dart = await fetch(`${base}/main.dart.js`);
  assert.equal(dart.status, 200);
  assert.match(await dart.text(), /__TOTEM_FLUTTER_FIXTURE__/);

  for (const retiredPath of ["/legacy", "/legacy/", "/graph-v2.html"]) {
    const retired = await fetch(`${base}${retiredPath}`);
    assert.equal(retired.status, 404, `${retiredPath} must not expose the retired JavaScript viewer`);
  }

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const healthPayload = await health.json();
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.mode, "local");
  assert.equal(healthPayload.agentAdapter.available, true);

  const flutterHealth = await fetch(`${base}/api/health`, {
    headers: { Origin: "http://localhost:54321" },
  });
  assert.equal(flutterHealth.status, 200);
  assert.equal(flutterHealth.headers.get("access-control-allow-origin"), "http://localhost:54321");

  const pagesHealth = await fetch(`${base}/api/health`, {
    headers: { Origin: "https://yunitrish006006.github.io" },
  });
  assert.equal(pagesHealth.status, 200);
  assert.equal(
    pagesHealth.headers.get("access-control-allow-origin"),
    "https://yunitrish006006.github.io",
    "published TotemWorkspace Pages must be able to reach the loopback bridge",
  );

  const preflight = await fetch(`${base}/api/refresh`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:54321",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

  const blocked = await fetch(`${base}/api/health`, {
    headers: { Origin: "https://example.com" },
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
    body: JSON.stringify({ prompt: "do not execute this" }),
  });
  assert.equal(blockedPrompt.status, 403, "Prompt submission must be rejected while Prompt is disabled");

  const enablePrompt = await fetch(`${base}/api/viewer-settings`, {
    method: "POST",
    headers: {
      Origin: "https://yunitrish006006.github.io",
      "content-type": "application/json",
    },
    body: JSON.stringify({ promptEnabled: true }),
  });
  assert.equal(enablePrompt.status, 200);
  assert.equal((await enablePrompt.json()).promptEnabled, true);

  const prompt = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: {
      Origin: "https://yunitrish006006.github.io",
      "content-type": "application/json",
    },
    body: JSON.stringify({ prompt: "inspect TotemCore", moduleId: "totem-core" }),
  });
  assert.equal(prompt.status, 202);
  const promptPayload = await prompt.json();
  assert.equal(promptPayload.execution, "codex");
  assert.equal(dispatchedPrompts.length, 1);
  assert.equal(dispatchedPrompts[0].moduleId, "totem-core");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(flutterFixture, { recursive: true, force: true });
  for (const [filePath, backup] of backups) {
    if (backup == null) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, backup);
    }
  }
}

console.log("Local viewer validation passed: Flutter is the sole served UI, retired legacy routes return 404, loopback/CORS boundaries hold, and Prompt/Activity semantics remain independent.");
