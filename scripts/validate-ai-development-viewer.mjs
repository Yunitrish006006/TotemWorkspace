#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const plan = read("docs/ai-development-graph-plan.md");
const server = read("scripts/serve-local-viewer.mjs");
const localValidation = read("scripts/validate-local-viewer.mjs");
const flutterLive = read("viewer_flutter/lib/live/workspace_live.dart");
const flutterHost = read("viewer_flutter/lib/widgets/workspace_graph_host.dart");
const flutterGraph = read("viewer_flutter/lib/widgets/graph_view.dart");
const flutterFloatingPanel = read("viewer_flutter/lib/widgets/floating_panel.dart");
const flutterActivityLocation = read("viewer_flutter/lib/widgets/activity_location.dart");
const flutterCollapsibleMessage = read("viewer_flutter/lib/widgets/collapsible_message.dart");
const pages = read(".github/workflows/pages.yml");
const workspaceValidation = read("scripts/validate-workspace.mjs");
const agents = read("AGENTS.md");

for (const phrase of [
  "Flutter production root",
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
  "/api/prompt",
  "/api/agent-adapter",
  "/api/orchestration-plan",
  "/api/replay",
  "/api/replay/frame"
]) {
  assert.ok(server.includes(endpoint), `local bridge is missing ${endpoint}`);
}
assert.ok(server.includes('"https://yunitrish006006.github.io"'), "official Pages origin must be explicitly allowlisted");
assert.ok(server.includes("access-control-allow-private-network"), "Pages-to-loopback private network preflight must be supported");
assert.ok(server.includes('"agent-adapter-required"'), "Prompt intake must explicitly remain adapter-gated");
assert.ok(server.includes('const FLUTTER_WEB_ROOT = path.join(ROOT, "viewer_flutter", "build", "web")'), "local bridge root must use the Flutter web build");
assert.ok(!server.includes('node:child_process'), "browser prompt intake must not gain direct shell execution");

for (const behavior of [
  "host == 'yunitrish006006.github.io'",
  "Future<ViewerSettings> viewerSettings()",
  "Future<ViewerSettings> updateViewerSettings",
  "Future<AgentActivityBatch> activity",
  "Future<PromptSubmission> submitPrompt",
  "Future<AgentAdapterStatus> agentAdapterStatus()",
  "Future<OrchestrationPlan> orchestrationPlan(",
  "class OrchestrationSummary",
  "class OrchestrationPlan",
  "class CodexUsage",
  "Future<DevelopmentReplayTimeline> replayTimeline()",
  "Future<DevelopmentReplayFrame> replayFrame(int sequence)"
]) {
  assert.ok(flutterLive.includes(behavior), `Flutter bridge integration is missing: ${behavior}`);
}

for (const behavior of [
  "ViewerSettings _settings = ViewerSettings.defaults",
  "_ActivityStrip(event: displayedActivity)",
  "_AgentAdapterStrip(",
  "_replayTimeline?.sessions.isNotEmpty == true",
  "'INTERRUPTED'",
  "_OrchestrationStrip(summary: _orchestration!)",
  "_liveErrorSource",
  "_ReplayScrubber(",
  "historicalEntityIds: historicalEntityIds",
  "if (isLocal && _settings.promptEnabled)",
  "events: _activity",
  "SelectableText(",
  "CollapsibleMessage(",
  "Switch.adaptive",
  "onPromptChanged"
]) {
  assert.ok(flutterHost.includes(behavior), `Flutter production surface is missing: ${behavior}`);
}

for (const behavior of [
  "class CollapsibleMessage",
  "maxLines: 2",
  "TextOverflow.ellipsis",
  "textPainter.didExceedMaxLines",
  "展開完整訊息",
  "收起訊息",
]) {
  assert.ok(flutterCollapsibleMessage.includes(behavior), `Flutter prompt output collapse behavior is missing: ${behavior}`);
}

for (const behavior of [
  "class ActivitySourceLocation",
  "event.type == 'file_edit' || event.type == 'symbol_edit'",
  "class ActivitySourceLocationCard",
  "ValueChanged<Rect> onTap",
  "MouseRegion",
  "bool keptOpen",
]) {
  assert.ok(flutterActivityLocation.includes(behavior), `Flutter interactive source location is missing: ${behavior}`);
}

for (const behavior of [
  "with SingleTickerProviderStateMixin",
  "activityFeatureId",
  "activityModuleId",
  "activityType",
  "activityPulse: _activityPulse",
  "if (agentActive)",
  "Color _activityColor",
  "_transientActivityExpanded",
  "historicalEntityIds"
]) {
  assert.ok(flutterGraph.includes(behavior), `Flutter graph activity overlay is missing: ${behavior}`);
}

assert.ok(
  /isLocal\s*&&\s*_settings\.agentActivityEnabled\s*&&\s*displayedActivity != null/.test(flutterHost) &&
    flutterHost.includes("if (isLocal && _settings.promptEnabled)"),
  "Prompt visibility and Agent Activity visibility must remain independent"
);

for (const behavior of [
  "enum FloatingPanelDock",
  "showModalBottomSheet<FloatingPanelDock>",
  "FloatingPanelDock.bottomRight",
]) {
  assert.ok(flutterFloatingPanel.includes(behavior), `Flutter floating panel behavior is missing: ${behavior}`);
}

assert.ok(pages.includes("cp -R viewer_flutter/build/web/. _site/"), "Flutter production surface must stay packaged");
assert.ok(!pages.includes("_site/legacy"), "Pages must not package a legacy viewer surface");
assert.ok(!pages.includes("graph-v2.html"), "Pages must not package the retired graph-v2 HTML");
assert.ok(!pages.includes("viewer/graph-v2"), "Pages must not package retired browser renderer assets");
assert.ok(!pages.includes("viewer/local-live.js"), "Pages must not package the retired browser live adapter");

for (const removed of [
  "graph-v2.html",
  "viewer/graph-v2.css",
  "viewer/graph-v2-adapter.js",
  "viewer/graph-v2-cluster.js",
  "viewer/graph-v2-cluster-v2.js",
  "viewer/local-live.js",
  "viewer/generated/graph-data.js",
]) {
  assert.equal(fs.existsSync(removed), false, `retired browser viewer artifact must stay removed: ${removed}`);
}

assert.ok(!workspaceValidation.includes('modules.length === 11'), "active module onboarding must not permanently hardcode eleven modules");
assert.ok(!workspaceValidation.includes('new Set(ids).size === 11'), "module uniqueness must derive from registry size");
assert.ok(agents.includes("registry is\n  extensible"), "agent instructions must preserve data-driven repository onboarding");
assert.ok(localValidation.includes("published TotemWorkspace Pages must be able to reach the loopback bridge"), "local bridge regression must test published Pages access");
assert.ok(localValidation.includes("Prompt must default to OFF"), "local bridge regression must protect Prompt default-off behavior");
assert.ok(localValidation.includes("Agent Activity must remain independent of Prompt"), "local bridge regression must protect Prompt/Activity independence");

console.log("AI development viewer validation passed: Flutter is the sole viewer surface, local Bridge semantics remain shared and loopback-only, and legacy browser assets stay removed.");
