#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const inventory = fs.readFileSync("intelligence/code-inventory.mjs", "utf8");
const graph = fs.readFileSync("intelligence/code-graph.mjs", "utf8");
const flutterData = fs.readFileSync("viewer_flutter/lib/model/graph_data.dart", "utf8");
const flutterScene = fs.readFileSync("viewer_flutter/lib/model/graph_scene.dart", "utf8");
const flutterView = fs.readFileSync("viewer_flutter/lib/widgets/graph_view.dart", "utf8");
const flutterHost = fs.readFileSync("viewer_flutter/lib/widgets/workspace_graph_host.dart", "utf8");
const flutterActivityLocation = fs.readFileSync("viewer_flutter/lib/widgets/activity_location.dart", "utf8");
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
  "node.kind == 'feature'",
  "node.kind == 'component'",
  "component.mappingConfidence",
  "'component' => const Color",
  "'implementation' => const Color",
]) {
  assert.ok(flutterView.includes(fragment), `Flutter interaction is missing: ${fragment}`);
}
assert.ok(flutterHost.includes("activityComponentId: graphFocusLocation?.componentId"),
  "Flutter host must forward source-card component IDs to semantic LOD");
assert.ok(flutterActivityLocation.includes("event.type == 'file_edit' || event.type == 'symbol_edit'"),
  "Flutter source-card focus must only originate from a targeted edit");
assert.ok(flutterHost.includes("_keptOpenActivityLocation ?? _hoveredActivityLocation"),
  "Flutter semantic focus must only persist while a source card is hovered or kept open");
assert.ok(flutterHost.includes("autoExpandAgentFocus: graphFocusLocation != null"),
  "Flutter source-card focus must expand only the explicitly requested semantic path");

for (const phrase of ["Progressive semantic LOD", "Component", "Implementation"]) {
  assert.ok(plan.includes(phrase), `AI development plan is missing semantic LOD term: ${phrase}`);
}

for (const removed of [
  "graph-v2.html",
  "viewer/graph-v2-cluster-v2.js",
  "viewer/local-live.js",
]) {
  assert.equal(fs.existsSync(removed), false, `legacy viewer artifact must stay removed: ${removed}`);
}

console.log("Semantic LOD validation passed: generic L3 component inference, confidence-gated Feature mapping, controlled L4 implementation, and Flutter activity focus are synchronized.");
