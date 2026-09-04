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
assert.ok(serverSource.includes('pathname === "/api/prompt"'), "prompt intake endpoint is required");
assert.ok(serverSource.includes('"https://yunitrish006006.github.io"'), "official TotemWorkspace Pages origin must be explicitly allowlisted");
assert.ok(serverSource.includes('"agent-adapter-required"'), "prompt intake must not claim direct agent execution");
assert.ok(serverSource.includes("activity file paths must be repository-relative"), "activity ingestion must reject absolute local file paths");
assert.ok(serverSource.includes('const FLUTTER_WEB_ROOT = path.join(ROOT, "viewer_flutter", "build", "web")'), "local bridge must serve the Flutter build by default");
assert.ok(serverSource.includes('decoded === "/legacy" || decoded === "/legacy/"'), "legacy JavaScript viewer must remain mounted under /legacy/");
assert.ok(serverSource.includes("workspaceStatus({ knowledge, reposRoot })"), "status endpoint must reuse workspaceStatus");
assert.ok(serverSource.includes("refreshCodeIndex({"), "refresh endpoint must reuse incremental code-index refresh");
assert.ok(serverSource.includes("renderGraphV2({ knowledge, index: refreshed.index })"), "refresh endpoint must regenerate graph data");
assert.ok(serverSource.includes("prepareApiCors(req, res)"), "Flutter dev access must pass through loopback-only CORS validation");
assert.ok(serverSource.includes("approved TotemWorkspace or loopback clients"), "browser CORS must be restricted to approved Pages or loopback origins");
assert.ok(!serverSource.includes('const DEFAULT_HOST = "0.0.0.0"'), "local viewer must not expose LAN by default");

assert.ok(html.includes('id="liveLocal"'), "viewer must expose LIVE LOCAL badge");
assert.ok(html.includes('id="localStatus"'), "viewer must expose local status button");
assert.ok(html.includes('id="refreshLocal"'), "viewer must expose local refresh button");
assert.ok(html.includes('<script src="viewer/local-live.js"></script>'), "viewer must load the local-live adapter");
assert.ok(html.includes("connect-src 'self' http://127.0.0.1:18765"), "legacy CSP must permit the loopback bridge");
assert.ok(liveSource.includes('apiUrl("/api/workspace-status")'), "legacy local adapter must poll workspace status through the local bridge base");
assert.ok(liveSource.includes('apiUrl("/api/refresh")'), "legacy local adapter must trigger index refresh through the local bridge base");
assert.ok(liveSource.includes('apiUrl("/api/viewer-settings")'), "legacy viewer must use shared local viewer settings");
assert.ok(liveSource.includes('apiUrl("/api/activity?after="'), "legacy viewer must poll shared agent activity");
assert.ok(liveSource.includes('apiUrl("/api/prompt")'), "legacy prompt surface must submit through the bridge");
assert.ok(liveSource.includes('host === "yunitrish006006.github.io"'), "legacy Pages must discover the loopback bridge");
assert.ok(liveSource.includes("window.setInterval(poll, 5000)"), "local status must refresh periodically");
assert.ok(liveSource.includes("window.location.reload()"), "successful local refresh must reload regenerated graph data");

const settingsPath = path.join(ROOT, ".totem-index", "viewer-settings.json");
const settingsBackup = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : null;
if (fs.existsSync(settingsPath)) fs.rmSync(settingsPath);

const flutterFixture = fs.mkdtempSync(path.join(os.tmpdir(), "totem-flutter-root-"));
fs.writeFileSync(path.join(flutterFixture, "index.html"), "<!doctype html><title>TOTEM Flutter fixture</title><script src=\"main.dart.js\"></script>", "utf8");
fs.writeFileSync(path.join(flutterFixture, "main.dart.js"), "window.__TOTEM_FLUTTER_FIXTURE__ = true;", "utf8");

const server = createLocalViewerServer({ flutterRoot: flutterFixture });
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
  assert.equal(healthPayload.activitySchemaVersion, 1);
  assert.equal(healthPayload.promptExecution, "agent-adapter-required");

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
  assert.equal(promptPayload.execution, "agent-adapter-required");
  assert.equal(promptPayload.event.type, "prompt_submitted");

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

  const activity = await fetch(`${base}/api/activity?after=0`);
  assert.equal(activity.status, 200);
  const activityPayload = await activity.json();
  assert.ok(activityPayload.latestSequence >= 2);
  assert.deepEqual(
    activityPayload.events.slice(-2).map((event) => event.type),
    ["prompt_submitted", "file_edit"]
  );

  const absolutePathEvent = await fetch(`${base}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "file_read", file: ["", "Users", "example", "private.java"].join("/") })
  });
  assert.equal(absolutePathEvent.status, 400, "absolute local paths must be rejected rather than stored");

  const status = await fetch(`${base}/api/workspace-status`);
  assert.equal(status.status, 200);
  const payload = await status.json();
  assert.equal(payload.mode, "local");
  assert.equal(payload.modules.length, 11);
  assert.ok(payload.modules.every((entry) => !Object.hasOwn(entry, "path")), "browser API must not expose absolute local repo paths");

  const flutterRoot = await fetch(`${base}/`);
  assert.equal(flutterRoot.status, 200);
  assert.match(await flutterRoot.text(), /TOTEM Flutter fixture/, "local bridge root must serve Flutter");

  const flutterAsset = await fetch(`${base}/main.dart.js`);
  assert.equal(flutterAsset.status, 200);
  assert.match(await flutterAsset.text(), /TOTEM_FLUTTER_FIXTURE/, "Flutter assets must be served from the local build root");

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
}

console.log("Local live viewer validation passed: Flutter owns /, legacy JS stays under /legacy/, and loopback-only API/settings/activity/refresh behavior remains intact.");
