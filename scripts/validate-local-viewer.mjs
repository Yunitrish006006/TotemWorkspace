#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
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
assert.ok(serverSource.includes("workspaceStatus({ knowledge, reposRoot })"), "status endpoint must reuse workspaceStatus");
assert.ok(serverSource.includes("refreshCodeIndex({"), "refresh endpoint must reuse incremental code-index refresh");
assert.ok(serverSource.includes("renderGraphV2({ knowledge, index: refreshed.index })"), "refresh endpoint must regenerate graph data");
assert.ok(!serverSource.includes('const DEFAULT_HOST = "0.0.0.0"'), "local viewer must not expose LAN by default");

assert.ok(html.includes('id="liveLocal"'), "viewer must expose LIVE LOCAL badge");
assert.ok(html.includes('id="localStatus"'), "viewer must expose local status button");
assert.ok(html.includes('id="refreshLocal"'), "viewer must expose local refresh button");
assert.ok(html.includes('<script src="viewer/local-live.js"></script>'), "viewer must load the local-live adapter");
assert.ok(liveSource.includes('fetch("api/workspace-status"'), "local adapter must poll workspace status");
assert.ok(liveSource.includes('fetch("api/refresh"'), "local adapter must trigger index refresh");
assert.ok(liveSource.includes("window.setInterval(poll, 5000)"), "local status must refresh periodically");
assert.ok(liveSource.includes("window.location.reload()"), "successful local refresh must reload regenerated graph data");

const server = createLocalViewerServer();
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
  assert.deepEqual(await health.json(), { status: "ok", mode: "local" });

  const status = await fetch(`${base}/api/workspace-status`);
  assert.equal(status.status, 200);
  const payload = await status.json();
  assert.equal(payload.mode, "local");
  assert.equal(payload.modules.length, 11);
  assert.ok(payload.modules.every((entry) => !Object.hasOwn(entry, "path")), "browser API must not expose absolute local repo paths");

  const page = await fetch(`${base}/graph-v2.html`);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("viewer/local-live.js"));
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("Local live viewer validation passed: loopback-only server, live repo status polling, static viewer serving, and refresh wiring are present.");
