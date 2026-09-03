#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "graph-v2.html"), "utf8");
const source = fs.readFileSync(path.join(root, "viewer", "graph-v2-cluster-v2.js"), "utf8");
const css = fs.readFileSync(path.join(root, "viewer", "graph-v2.css"), "utf8");
const pages = fs.readFileSync(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
const audit = JSON.parse(fs.readFileSync(path.join(root, "data", "relationship-audit.json"), "utf8"));

assert.doesNotThrow(() => new Function(source), "cluster v2 renderer must parse");
assert.ok(html.includes('src="viewer/graph-v2-cluster-v2.js"'), "HTML must load the cluster v2 renderer");
assert.ok(!html.includes('src="viewer/graph-v2-cluster.js"'), "HTML must not load the legacy cluster renderer");
assert.ok(!html.includes('src="viewer/graph-v2.js"'), "standalone 3D must not load the deleted base/2D renderer");
assert.ok(!fs.existsSync(path.join(root, "viewer", "graph-v2.js")), "legacy 2D/base renderer must be deleted");
assert.ok(html.includes("固定散點分層"), "gesture/layout hint must describe deterministic scatter clusters");
assert.ok(html.includes("右鍵拖曳平移"), "desktop hint must expose right-button camera pan");
assert.ok(css.includes(".canvas3d:focus-visible"), "standalone 3D canvas must expose visible keyboard focus");
assert.ok(pages.includes("cp viewer/graph-v2-cluster-v2.js _site/viewer/graph-v2-cluster-v2.js"), "Pages must publish the cluster v2 renderer");

for (const required of [
  "function hashUnit",
  "function clusterRadius",
  "function moduleOrbitRadius",
  "function modulePosition",
  "function scatter",
  "function featureRelations",
  "function relationAwareScatter",
  "function isRetargetable",
  "function manualFeatureFor",
  "function capabilityConsumerEndpoint",
  "function panBy",
  "function drawCluster",
  "function drawArrowhead",
  "function keyboardNodes",
  "function showContracts",
  "clusters.push",
  "feature-detail",
  "shared-capability",
  "Shared Manual links",
  "Core API links",
  "window.__TOTEM_CLUSTER_3D_V2__"
]) assert.ok(source.includes(required), `missing cluster v2 behavior: ${required}`);

assert.ok(!source.includes("Math.random"), "cluster positions must remain deterministic across reloads");
assert.ok(source.includes('type === "category"'), "generated code semantic radius band must remain present");
assert.ok(source.includes('type === "capability"'), "shared capability semantic radius band must remain present");
assert.ok(source.includes('contract.type === "hard-core"'), "audited hard Core contracts with feature endpoints must remain retargetable");
assert.ok(source.includes("cluster.radius * projected.scale"), "cluster boundary must scale with the same 3D projection as its module");
assert.ok(source.includes("spotlightOwner"), "spotlight must influence cluster visibility");
assert.ok(source.includes("relatedOwners"), "clusters connected to the spotlight must remain partially emphasized");
assert.ok(source.includes("cam.panX"), "cluster view must preserve camera-center panning");
assert.ok(source.includes("gesture.startZoom"), "cluster view must preserve pinch zoom");
assert.ok(source.includes('title: "Feature groups"'), "module detail parity must include featureGroups metadata");
assert.ok(source.includes('canvas.addEventListener("keydown"'), "3D-only renderer must preserve keyboard node activation");
assert.ok(source.includes("if (!internal) drawArrowhead"), "relationship directions must be visible through arrowheads");

// Desktop input regression: left button rotates, right button pans, context menu is suppressed.
assert.ok(source.includes('event.button !== 0 && event.button !== 2'), "desktop pointerdown must accept left and right mouse buttons only");
assert.ok(source.includes('event.button === 2 ? "pan" : "rotate"'), "right mouse button must select pan mode");
assert.ok(source.includes('pointer.mode === "pan"'), "right-drag pointer movement must execute pan mode");
assert.ok(source.includes("panBy(dx, dy)"), "desktop pan must update camera projection center rather than canvas CSS position");
assert.ok(source.includes('canvas.addEventListener("contextmenu"'), "right-drag must suppress the browser context menu");
assert.ok(!source.includes("canvas.style.transform"), "desktop pan must not translate the canvas DOM element");

// Shared Manual regression: a curated consumer manual feature must replace the synthetic capability point.
assert.ok(source.includes('/manual|手冊/i'), "manual capability endpoint must recognize curated manual features");
assert.ok(source.includes("manualFeatureFor(capability.consumerModuleId)"), "consumer-side manual feature must be resolved from the capability consumer module");
assert.ok(source.includes("return inferred.id"), "expanded consumer must retarget the shared manual edge to the curated manual feature");
assert.ok(source.includes("syntheticCaps"), "modules without a curated manual feature must still retain a synthetic capability point");
assert.ok(source.includes("capability.providerFeatureId"), "provider-side Core Manual feature retargeting must remain intact");

// Core topology regression: TotemCore is the fixed world-space center and only non-Core modules use the orbit.
assert.ok(source.includes('if (module.id === "totem-core") return { x: 0, y: 0, z: 0 };'), "TotemCore must be anchored to the 3D world origin");
assert.ok(source.includes('var coreModule = modules.find(function (module) { return module.id === "totem-core"; });'), "scene must resolve Core separately from the peripheral orbit");
assert.ok(source.includes('module.id !== "totem-core"'), "peripheral module orbit must exclude TotemCore");
assert.ok(source.includes("modulePosition(coreModule, 0, peripheralModules.length, moduleRadius)"), "scene must place Core through the center-aware position helper");
assert.ok(source.includes("modulePosition: modulePosition"), "Core-centered module positioning must remain exposed for renderer regression inspection");

assert.deepEqual(audit.contractOverrides["hard:totem-nexus:totem-core"].featureIds, [
  "totem-nexus.feature-5", "totem-core.feature-3"
]);
assert.deepEqual(audit.contractOverrides["hard:totem-locksmith:totem-core"].featureIds, [
  "totem-locksmith.feature-2", "totem-core.feature-3"
]);

const orbitMatch = source.match(/function moduleOrbitRadius\(count\)\s*\{([\s\S]*?)\n  \}/);
assert.ok(orbitMatch, "module orbit spacing function must be extractable for regression checks");
const moduleOrbitRadius = new Function("count", orbitMatch[1]);
assert.equal(moduleOrbitRadius(0), 330, "collapsed overview should retain the compact module orbit");
assert.ok(moduleOrbitRadius(1) > moduleOrbitRadius(0), "expanding the first module must spread every module anchor outward");
assert.ok(moduleOrbitRadius(4) > moduleOrbitRadius(1), "additional expanded clusters should continue increasing module spacing");
assert.ok(moduleOrbitRadius(11) <= 630, "full expansion spacing must remain bounded");
assert.ok(source.includes("var moduleRadius = moduleOrbitRadius(expandedCount)"), "scene layout must use the dynamic module orbit radius");


// Relation-aware layout regression: topology degree drives deterministic junction placement without inventing graph semantics.
assert.ok(source.includes("weightedCentroid"), "relation-aware feature placement must target a weighted geometric junction");
assert.ok(source.includes("Math.log2(degree + 1)"), "higher relationship degree must increase topology influence");
assert.ok(source.includes("slotStrength = 0.22 / Math.sqrt"), "high-degree nodes sharing a junction must receive deterministic angular slotting");
assert.ok(source.includes('relation.targetId === "totem-core"'), "inward placement must distinguish real Core targets from accidental center crossings");
assert.ok(source.includes("inwardness < -0.18"), "peripheral nodes without Core relations must avoid unexplained inward folds");
assert.ok(source.includes("featureContractIds"), "relation discovery must include curated feature contract memberships");
assert.ok(source.includes("capability.providerFeatureId === featureId"), "Core shared-capability providers must participate in junction placement");
assert.ok(source.includes("relationAwareScatter(parent, feature.id"), "curated feature placement must use relation-aware scatter");
assert.ok(source.includes("featureRelations: featureRelations"), "relation topology must be exposed for deterministic regression inspection");
assert.ok(source.includes("relationAwareScatter: relationAwareScatter"), "relation-aware placement must be exposed for deterministic regression inspection");

console.log("3D cluster v2 validation passed: standalone 3D parity, Core-centered topology, deterministic relation-aware clusters, dynamic spacing, audited Core friendship retargeting, symmetric Shared Manual endpoints, directed edges, keyboard navigation, gestures, spotlight integration, and Pages packaging are present.");
