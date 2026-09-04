#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const inventory = fs.readFileSync("intelligence/code-inventory.mjs", "utf8");
const graph = fs.readFileSync("intelligence/code-graph.mjs", "utf8");
const flutterData = fs.readFileSync("viewer_flutter/lib/model/graph_data.dart", "utf8");
const flutterScene = fs.readFileSync("viewer_flutter/lib/model/graph_scene.dart", "utf8");
const flutterView = fs.readFileSync("viewer_flutter/lib/widgets/graph_view.dart", "utf8");
const flutterHost = fs.readFileSync("viewer_flutter/lib/widgets/workspace_graph_host.dart", "utf8");
const legacy = fs.readFileSync("viewer/graph-v2-cluster-v2.js", "utf8");
const live = fs.readFileSync("viewer/local-live.js", "utf8");
const plan = fs.readFileSync("docs/ai-development-graph-plan.md", "utf8");

assert.ok(inventory.includes("schemaVersion: 5"), "code inventory schema must expose L3 components");
for (const field of [
  'id: `component:${module.id}:${area.key}`',
  "responsibility:",
  "featureIds: mapping.featureIds",
  "mappingConfidence:",
  "implementationPaths:",
  "surfaceKinds:",
]) {
  assert.ok(inventory.includes(field), `component inventory is missing: ${field}`);
}
assert.ok(inventory.includes("SEMANTIC_CONCEPT_ALIASES"), "component-to-feature mapping must use generic semantic concepts");
assert.ok(!/componentFeatureMatch[\s\S]{0,10000}module\.id\s*===\s*["']totem-/m.test(inventory),
  "component inference must not contain module-specific branches");

assert.ok(graph.includes("schemaVersion: 5"), "graph schema must preserve semantic components while adding Verification Graph");
assert.ok(graph.includes("function semanticComponents"), "graph must promote inventory components to graph entities");
assert.ok(graph.includes("components,"), "graph payload must expose components");

for (const fragment of [
  "class GraphComponent",
  "List<GraphComponent> components",
  "GraphComponent? componentById",
  "List<GraphComponent> componentsForFeature",
  "List<GraphComponent> componentsForModule",
]) {
  assert.ok(flutterData.includes(fragment), `Flutter model is missing: ${fragment}`);
}

for (const fragment of [
  "kind == 'component'",
  "kind == 'implementation'",
  "data.componentsForFeature(featureId)",
  "data.componentById(componentId)",
  "'contains-component:",
  "'contains-implementation:",
  "component.implementationPaths.take(10)",
]) {
  assert.ok(flutterScene.includes(fragment), `Flutter scene semantic LOD is missing: ${fragment}`);
}
assert.ok(
  flutterScene.indexOf("data.componentsForFeature(featureId)") < flutterScene.indexOf("component.implementationPaths.take(10)"),
  "Flutter must reveal components before implementation files"
);

for (const fragment of [
  "activityComponentId",
  "autoExpandAgentFocus",
  "node.kind == 'feature' || node.kind == 'component'",
  "component.mappingConfidence",
  "'component' => const Color",
  "'implementation' => const Color",
]) {
  assert.ok(flutterView.includes(fragment), `Flutter interaction is missing: ${fragment}`);
}
assert.ok(flutterHost.includes("activityComponentId: displayedGraphActivity?.componentId"),
  "Flutter host must forward persistent semantic Agent Activity component IDs");
assert.ok(flutterHost.includes("event.type == 'file_edit' || event.type == 'symbol_edit' || event.type == 'git_diff_updated'"),
  "Flutter must preserve the latest targeted edit while a task remains active");
assert.ok(flutterHost.includes("event.componentId != null || event.featureId != null || event.moduleId != null"),
  "Flutter semantic focus must fall back through component/feature/module targets");
assert.ok(flutterHost.includes("autoExpandAgentFocus: _settings.autoExpandAgentFocus"),
  "Flutter Agent Activity expansion must respect shared viewer settings");

for (const fragment of [
  "var components = DATA.components || []",
  "var componentMap = new Map",
  'type: "component"',
  'type: "implementation"',
  '"contains-component:"',
  '"contains-implementation:"',
  "component.implementationPaths",
  "function focusActivity",
  "agentActivity.componentId && byId.has(agentActivity.componentId)",
]) {
  assert.ok(legacy.includes(fragment), `legacy semantic LOD is missing: ${fragment}`);
}
assert.ok(!legacy.includes('type: "category"'), "legacy module expansion must not fall back to generic code-category nodes");

assert.ok(live.includes('renderer.focusActivity(window.__TOTEM_AGENT_ACTIVITY__, settings.autoExpandAgentFocus !== false)'),
  "legacy Agent Activity must auto-expand the preserved semantic edit path");
assert.ok(live.includes("event.componentId || event.featureId || event.moduleId"),
  "legacy activity target label must prioritize components");
assert.ok(live.includes("latestLiveSemanticActivity"),
  "legacy viewer must preserve the latest targeted semantic edit instead of losing focus to targetless activity");
assert.ok(live.includes("event.type === \"file_edit\" || event.type === \"symbol_edit\" || event.type === \"git_diff_updated\""),
  "legacy semantic focus must track edits and incremental graph refresh activity");

for (const phrase of ["Progressive semantic LOD", "Component", "Implementation"]) {
  assert.ok(plan.includes(phrase), `AI development plan is missing semantic LOD term: ${phrase}`);
}

console.log("Semantic LOD validation passed: generic L3 component inference, confidence-gated Feature mapping, controlled L4 implementation, and component Agent Activity are synchronized across Flutter and legacy.");
