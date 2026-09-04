#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const plan = read("docs/ai-development-graph-plan.md");
const server = read("scripts/serve-local-viewer.mjs");
const localValidation = read("scripts/validate-local-viewer.mjs");
const legacyHtml = read("graph-v2.html");
const legacyLive = read("viewer/local-live.js");
const legacyRenderer = read("viewer/graph-v2-cluster-v2.js");
const flutterLive = read("viewer_flutter/lib/live/workspace_live.dart");
const flutterHost = read("viewer_flutter/lib/widgets/workspace_graph_host.dart");
const flutterGraph = read("viewer_flutter/lib/widgets/graph_view.dart");
const pages = read(".github/workflows/pages.yml");
const workspaceValidation = read("scripts/validate-workspace.mjs");
const agents = read("AGENTS.md");

for (const phrase of [
  "Flutter production root",
  "Legacy standalone 3D",
  "Prompt visibility toggle",
  "Repository onboarding",
  "Agent activity event model",
  "Progressive semantic LOD"
]) {
  assert.ok(plan.includes(phrase), `AI development graph plan is missing: ${phrase}`);
}

for (const endpoint of [
  "/api/viewer-settings",
  "/api/activity",
  "/api/prompt"
]) {
  assert.ok(server.includes(endpoint), `local bridge is missing ${endpoint}`);
}
assert.ok(server.includes('"https://yunitrish006006.github.io"'), "official Pages origin must be explicitly allowlisted");
assert.ok(server.includes("access-control-allow-private-network"), "Pages-to-loopback private network preflight must be supported");
assert.ok(server.includes('"agent-adapter-required"'), "Prompt intake must explicitly remain adapter-gated");
assert.ok(server.includes('const FLUTTER_WEB_ROOT = path.join(ROOT, "viewer_flutter", "build", "web")'), "local bridge root must use the Flutter web build");
assert.ok(server.includes('decoded === "/legacy" || decoded === "/legacy/"'), "legacy maintained surface must remain mounted under /legacy/");
assert.ok(!server.includes('node:child_process'), "Phase 1 browser prompt intake must not gain direct shell execution");

for (const id of [
  'id="agentActivity"',
  'id="promptToggle"',
  'id="promptBar"',
  'id="promptInput"',
  'id="promptSubmit"'
]) {
  assert.ok(legacyHtml.includes(id), `legacy maintained surface is missing ${id}`);
}
assert.ok(legacyHtml.includes("connect-src 'self' http://127.0.0.1:18765"), "legacy CSP must allow only the loopback bridge connection");

for (const behavior of [
  'apiUrl("/api/viewer-settings")',
  'apiUrl("/api/activity?after="',
  'apiUrl("/api/prompt")',
  'settings.agentActivityEnabled === false',
  'settings.promptEnabled === true',
  'host === "yunitrish006006.github.io"',
  'window.__TOTEM_AGENT_ACTIVITY__ = event',
  'window.setInterval(requestAgentDraw, 80)'
]) {
  assert.ok(legacyLive.includes(behavior), `legacy local adapter parity is missing: ${behavior}`);
}

for (const behavior of [
  "function drawAgentActivityHalo",
  "function agentActivityColor",
  "agentActivity.featureId && byId.has(agentActivity.featureId)",
  "agentActivity.moduleId && byId.has(agentActivity.moduleId)",
  "drawAgentActivityHalo(ctx, p, activityRadius"
]) {
  assert.ok(legacyRenderer.includes(behavior), `legacy activity overlay is missing: ${behavior}`);
}

for (const behavior of [
  "host == 'yunitrish006006.github.io'",
  "Future<ViewerSettings> viewerSettings()",
  "Future<ViewerSettings> updateViewerSettings",
  "Future<AgentActivityBatch> activity",
  "Future<AgentActivityEvent> submitPrompt"
]) {
  assert.ok(flutterLive.includes(behavior), `Flutter bridge parity is missing: ${behavior}`);
}

for (const behavior of [
  "ViewerSettings _settings = ViewerSettings.defaults",
  "_ActivityStrip(event: _activity.last)",
  "if (isLocal && _settings.promptEnabled)",
  "if (isLocal && _settings.agentActivityEnabled && _activity.isNotEmpty)",
  "Switch.adaptive",
  "onPromptChanged"
]) {
  assert.ok(flutterHost.includes(behavior), `Flutter maintained surface is missing: ${behavior}`);
}

for (const behavior of [
  "with SingleTickerProviderStateMixin",
  "activityFeatureId",
  "activityModuleId",
  "activityType",
  "activityPulse: _activityPulse",
  "if (agentActive)",
  "Color _activityColor"
]) {
  assert.ok(flutterGraph.includes(behavior), `Flutter activity overlay is missing: ${behavior}`);
}
assert.ok(
  flutterHost.includes("if (isLocal && _settings.agentActivityEnabled && _activity.isNotEmpty)") &&
    flutterHost.includes("if (isLocal && _settings.promptEnabled)"),
  "Prompt visibility and Agent Activity visibility must remain independent"
);

assert.ok(pages.includes("cp -R viewer_flutter/build/web/. _site/"), "Flutter production surface must stay packaged");
for (const packaged of [
  "cp graph-v2.html _site/legacy/index.html",
  "cp viewer/graph-v2.css _site/legacy/viewer/graph-v2.css",
  "cp viewer/graph-v2-cluster-v2.js _site/legacy/viewer/graph-v2-cluster-v2.js",
  "cp viewer/local-live.js _site/legacy/viewer/local-live.js",
  "cp viewer/generated/graph-data.js _site/legacy/viewer/generated/graph-data.js"
]) {
  assert.ok(pages.includes(packaged), `legacy maintained surface packaging is missing: ${packaged}`);
}

assert.ok(!workspaceValidation.includes('modules.length === 11'), "active module onboarding must not permanently hardcode eleven modules");
assert.ok(!workspaceValidation.includes('new Set(ids).size === 11'), "module uniqueness must derive from registry size");
assert.ok(agents.includes("registry is\n  extensible"), "agent instructions must preserve data-driven repository onboarding");
assert.ok(agents.includes("Both maintained Pages viewer surfaces"), "agent instructions must require viewer parity");

assert.ok(localValidation.includes("published TotemWorkspace Pages must be able to reach the loopback bridge"), "local bridge regression must test published Pages access");
assert.ok(localValidation.includes("Prompt must default to OFF"), "local bridge regression must protect Prompt default-off behavior");
assert.ok(localValidation.includes("Agent Activity must remain independent of Prompt"), "local bridge regression must protect Prompt/Activity independence");

console.log("AI development viewer validation passed: Flutter owns both Pages and local Bridge roots, /legacy/ remains synchronized, prompt/activity semantics stay shared, and the Bridge remains loopback-only and adapter-gated.");
