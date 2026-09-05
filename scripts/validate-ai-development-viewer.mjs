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
const flutterFloatingPanel = read("viewer_flutter/lib/widgets/floating_panel.dart");
const flutterActivityLocation = read("viewer_flutter/lib/widgets/activity_location.dart");
const flutterCollapsibleMessage = read("viewer_flutter/lib/widgets/collapsible_message.dart");
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
assert.ok(server.includes('decoded === "/legacy" || decoded === "/legacy/"'), "legacy maintained surface must remain mounted under /legacy/");
assert.ok(!server.includes('node:child_process'), "Phase 1 browser prompt intake must not gain direct shell execution");

for (const id of [
  'id="agentActivity"',
  'id="agentAdapter"',
  'id="orchestrationState"',
  'id="replayBar"',
  'id="replaySlider"',
  'id="replayLive"',
  'id="promptToggle"',
  'id="promptBar"',
  'id="promptInput"',
  'id="promptSubmit"',
  'id="codexConsole"',
  'id="codexConsoleHeader"',
  'id="codexConsoleBody"'
]) {
  assert.ok(legacyHtml.includes(id), `legacy maintained surface is missing ${id}`);
}
assert.ok(legacyHtml.includes("connect-src 'self' http://127.0.0.1:18765"), "legacy CSP must allow only the loopback bridge connection");

for (const behavior of [
  'apiUrl("/api/viewer-settings")',
  'apiUrl("/api/activity?after="',
  'apiUrl("/api/prompt")',
  'apiUrl("/api/agent-adapter")',
  'latestAdapterStatus',
  'replaySession.state === "running" ? "INTERRUPTED"',
  'renderOrchestration(payload.orchestration)',
  'apiUrl("/api/replay")',
  'apiUrl("/api/replay/frame?sequence=" +',
  'window.__TOTEM_REPLAY_GRAPH_STATE__ = frame.graphState || null',
  'settings.agentActivityEnabled === false',
  'settings.promptEnabled === true',
  'host === "yunitrish006006.github.io"',
  'window.__TOTEM_AGENT_ACTIVITY__ = semanticFocus && hasSemanticTarget(semanticFocus) ? semanticFocus : null',
  'latestLiveSemanticActivity',
  'appendCodexTranscript(events)',
  'codexEventLabel(event)',
  'codexConsoleBody.scrollTop = codexConsoleBody.scrollHeight',
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
  "Future<PromptSubmission> submitPrompt",
  "Future<AgentAdapterStatus> agentAdapterStatus()",
  "Future<OrchestrationPlan> orchestrationPlan(",
  "class OrchestrationSummary",
  "class OrchestrationPlan",
  "class CodexUsage",
  "detail: json['detail'] as String?",
  "command: json['command'] as String?",
  "tool: json['tool'] as String?",
  "Future<DevelopmentReplayTimeline> replayTimeline()",
  "Future<DevelopmentReplayFrame> replayFrame(int sequence)"
]) {
  assert.ok(flutterLive.includes(behavior), `Flutter bridge parity is missing: ${behavior}`);
}

for (const behavior of [
  "ViewerSettings _settings = ViewerSettings.defaults",
  "_ActivityStrip(event: displayedActivity)",
  "_AgentAdapterStrip(",
  "_replayTimeline?.sessions.isNotEmpty == true",
  "'INTERRUPTED'",
  "_OrchestrationStrip(summary: _orchestration!)",
  "_liveErrorSource",
  "Local API issue · ${errorSource ?? 'unknown'}",
  "_ReplayScrubber(",
  "historicalEntityIds: historicalEntityIds",
  "if (isLocal && _settings.promptEnabled)",
  "events: _activity",
  "'CODEX CONSOLE · ${widget.taskId} · ${taskEvents.length} events'",
  "minLines: 1",
  "maxLines: compact ? 3 : 6",
  "SelectableText(",
  "CollapsibleMessage(",
  "Switch.adaptive",
  "onPromptChanged"
]) {
  assert.ok(flutterHost.includes(behavior), `Flutter maintained surface is missing: ${behavior}`);
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
  "second modified-files list",
  "class ActivitySourceLocationCard",
  "ValueChanged<Rect> onTap",
  "MouseRegion",
  "onHoverChanged?.call(true)",
  "bool keptOpen",
  "onKeepOpenChanged",
  "繼續開著",
  "查看變更位置",
]) {
  assert.ok(flutterActivityLocation.includes(behavior), `Flutter interactive source location is missing: ${behavior}`);
}
for (const behavior of [
  "locationForEvent: _activityLocationFor",
  "onLocationSelected: _showActivitySourceLocation",
  "onLocationHoverChanged: _setHoveredActivityLocation",
  "onLocationKeepOpenChanged: _toggleKeptOpenActivityLocation",
  "keptOpenLocation: _keptOpenActivityLocation",
  "showMenu<void>(",
  "activityFeatureId: graphFocusLocation?.featureId",
  "showChangeNodeIndicators: false",
  "ActivitySourceLocationCard(",
]) {
  assert.ok(flutterHost.includes(behavior), `Flutter console must expose clickable source locations: ${behavior}`);
}
assert.ok(
  !flutterHost.includes('liveSemanticActivity') &&
    !flutterHost.includes('displayedGraphActivity') &&
    flutterHost.includes('activityModuleId: graphFocusLocation?.moduleId') &&
    flutterHost.includes('_keptOpenActivityLocation ?? _hoveredActivityLocation'),
  'Flutter graph changes must only focus a node while its source-location card is hovered or explicitly kept open'
);

for (const behavior of [
  "with SingleTickerProviderStateMixin",
  "activityFeatureId",
  "activityModuleId",
  "activityType",
  "activityPulse: _activityPulse",
  "if (agentActive)",
  "Color _activityColor",
  "_transientActivityExpanded",
  "Set<String> get _visibleExpanded",
  "showChangeNodeIndicators && changedEntityIds.contains(node.id)",
  "BrowserContextMenu.disableContextMenu()",
  "BrowserContextMenu.enableContextMenu()",
  "orchestration_planned",
  "historicalEntityIds"
]) {
  assert.ok(flutterGraph.includes(behavior), `Flutter activity overlay is missing: ${behavior}`);
}
assert.ok(!flutterHost.includes("Local API temporarily unavailable"), "Flutter warning must identify the failing subsystem instead of showing a generic Local API message");
assert.ok(!flutterHost.includes("_liveError = submission.execution == 'agent-adapter-unavailable'"), "agent-adapter unavailable must remain an adapter status, not masquerade as Local API failure");

assert.ok(
  /isLocal\s*&&\s*_settings\.agentActivityEnabled\s*&&\s*displayedActivity != null/.test(flutterHost) &&
    flutterHost.includes("if (isLocal && _settings.promptEnabled)"),
  "Prompt visibility and Agent Activity visibility must remain independent"
);
for (const behavior of [
  "enum FloatingPanelDock",
  "showModalBottomSheet<FloatingPanelDock>",
  "選擇一個固定位置；面板會保持在畫面內。",
  "FloatingPanelDock.bottomRight",
]) {
  assert.ok(flutterFloatingPanel.includes(behavior), `Flutter floating panel behavior is missing: ${behavior}`);
}
for (const behavior of [
  "FloatingPanel(",
  "title: '工作區'",
  "title: '開發活動'",
  "title: taskId == null ? 'Prompt' : 'Prompt · Codex Console'",
]) {
  assert.ok(flutterHost.includes(behavior), `Flutter host must keep ${behavior} as a floating panel`);
}
assert.ok(
  flutterGraph.includes("title: '圖表控制'") &&
    flutterGraph.includes("icon: Icons.info_outline") &&
    !flutterGraph.includes("SizedBox(width: 360, child: infoPanel)"),
  "Graph controls and node details must float above the canvas instead of reserving a fixed column"
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

console.log("AI development viewer validation passed: Flutter owns both Pages and local Bridge roots, /legacy/ remains synchronized, prompt/activity/orchestration/agent-adapter/replay semantics stay shared, and the Bridge remains loopback-only and explicitly adapter-gated.");
