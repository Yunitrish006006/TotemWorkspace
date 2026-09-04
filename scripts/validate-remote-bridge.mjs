#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const bridge = fs.readFileSync("tools/remote/bridge.sh", "utf8");
const remoteGuide = fs.readFileSync("tools/remote/README.md", "utf8");
const tasks = JSON.parse(fs.readFileSync(".vscode/tasks.json", "utf8"));
const server = fs.readFileSync("scripts/serve-local-viewer.mjs", "utf8");
const flutter = fs.readFileSync("viewer_flutter/lib/live/workspace_live.dart", "utf8");
const legacy = fs.readFileSync("viewer/local-live.js", "utf8");
const legacyHtml = fs.readFileSync("graph-v2.html", "utf8");
const activityCli = fs.readFileSync("scripts/totem-activity.mjs", "utf8");

for (const fragment of [
  'SESSION="${TOTEM_BRIDGE_SESSION:-totem-workspace-bridge}"',
  'PORT="${TOTEM_BRIDGE_PORT:-18765}"',
  'BACKEND="${TOTEM_BRIDGE_BACKEND:-auto}"',
  'HOST="127.0.0.1"',
  'tmux new-session -d',
  'tmux kill-session',
  'tmux attach-session',
  'nohup node scripts/serve-local-viewer.mjs',
  '.totem-index/remote-bridge.pid',
  'scripts/serve-local-viewer.mjs --port',
  '.totem-index/remote-bridge.log',
  'Cannot start Totem Bridge: remote port',
]) {
  assert.ok(bridge.includes(fragment), `remote bridge controller is missing: ${fragment}`);
}

for (const action of ["start)", "stop)", "restart)", "status)", "logs)", "follow)", "attach)", "doctor)"]) {
  assert.ok(bridge.includes(action), `remote bridge controller is missing action: ${action}`);
}

assert.ok(remoteGuide.includes("LocalForward 127.0.0.1:18765 127.0.0.1:18765"), "remote guide must document the VS Code SSH tunnel");
assert.ok(remoteGuide.includes("bash tools/remote/bridge.sh start"), "remote guide must document bridge startup");
assert.ok(remoteGuide.includes("tmux"), "remote guide must document tmux background execution");
assert.ok(remoteGuide.includes("nohup"), "remote guide must document the no-sudo nohup fallback");
assert.ok(remoteGuide.includes("sudo is not required"), "remote guide must explain that Bridge background execution does not require sudo");

const labels = new Set((tasks.tasks ?? []).map((task) => task.label));
for (const label of [
  "Totem: Start Bridge",
  "Totem: Bridge Status",
  "Totem: Bridge Logs",
  "Totem: Restart Bridge",
  "Totem: Stop Bridge",
]) {
  assert.ok(labels.has(label), `VS Code shared task is missing: ${label}`);
}

assert.ok(server.includes('const DEFAULT_PORT = 18765;'), "bridge server default port must be 18765");
assert.ok(flutter.includes("http://127.0.0.1:18765"), "Flutter Pages must discover port 18765");
assert.ok(legacy.includes('return "http://127.0.0.1:18765"'), "legacy Pages must discover port 18765");
assert.ok(legacyHtml.includes("http://127.0.0.1:18765"), "legacy CSP must allow port 18765");
assert.ok(activityCli.includes('"http://127.0.0.1:18765"'), "activity CLI must default to port 18765");

for (const [label, source] of [
  ["bridge server", server],
  ["Flutter live client", flutter],
  ["legacy live client", legacy],
  ["legacy CSP", legacyHtml],
  ["activity CLI", activityCli],
]) {
  assert.ok(!source.includes("127.0.0.1:8765"), `${label} still contains the retired bridge port 8765`);
}

console.log("Remote bridge validation passed: tmux lifecycle, VS Code tasks, SSH forwarding docs, and shared 18765 port contract are consistent.");
