#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "graph-v2.html"), "utf8");
const source = fs.readFileSync(path.join(root, "viewer", "graph-v2-cluster.js"), "utf8");
const css = fs.readFileSync(path.join(root, "viewer", "graph-v2.css"), "utf8");
const pages = fs.readFileSync(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
const audit = JSON.parse(fs.readFileSync(path.join(root, "data", "relationship-audit.json"), "utf8"));

assert.doesNotThrow(() => new Function(source), "cluster renderer must parse");
assert.ok(html.includes('src="viewer/graph-v2-cluster.js"'), "HTML must load the cluster renderer");
assert.ok(
  html.indexOf('src="viewer/graph-v2.js"') < html.indexOf('src="viewer/graph-v2-cluster.js"'),
  "cluster renderer must load after the base renderer"
);
assert.ok(html.includes("固定散點分層"), "gesture/layout hint must describe deterministic scatter clusters");
assert.ok(css.includes(".cluster3d{position:absolute;inset:0"), "cluster canvas must overlay the 3D pane instead of changing document flow");
assert.ok(pages.includes("cp viewer/graph-v2-cluster.js _site/viewer/graph-v2-cluster.js"), "Pages must publish the cluster renderer");

for (const required of [
  "function hashUnit",
  "function clusterRadius",
  "function moduleOrbitRadius",
  "function scatter",
  "function isRetargetable",
  "function drawCluster",
  "clusters.push",
  "feature-detail",
  "shared-capability",
  "Core API links",
  "window.__TOTEM_CLUSTER_3D__"
]) assert.ok(source.includes(required), `missing cluster behavior: ${required}`);

assert.ok(!source.includes("Math.random"), "cluster positions must remain deterministic across reloads");
assert.ok(source.includes('type==="category"?[.72,.96]'), "generated code must occupy the outer semantic radius band");
assert.ok(source.includes('type==="capability"?[.56,.78]'), "shared capabilities must occupy the middle semantic radius band");
assert.ok(source.includes(':[.34,.64]'), "curated features must occupy the inner semantic radius band");
assert.ok(source.includes('c.type==="hard-core"&&(c.featureIds||[]).length>0'), "audited hard Core contracts with feature endpoints must be retargetable");
assert.ok(source.includes("c.radius*p.scale"), "cluster boundary must scale with the same 3D projection as its module");
assert.ok(source.includes("spotOwner"), "spotlight must influence cluster visibility");
assert.ok(source.includes("relatedOwners"), "clusters connected to the spotlight must remain partially emphasized");
assert.ok(source.includes("cam.panX"), "cluster view must preserve camera-center panning");
assert.ok(source.includes("gesture.startZoom"), "cluster view must preserve pinch zoom");

assert.deepEqual(audit.contractOverrides["hard:totem-nexus:totem-core"].featureIds, [
  "totem-nexus.feature-5", "totem-core.feature-3"
]);
assert.deepEqual(audit.contractOverrides["hard:totem-locksmith:totem-core"].featureIds, [
  "totem-locksmith.feature-2", "totem-core.feature-3"
]);

const orbitMatch = source.match(/function moduleOrbitRadius\(count\)\{([^}]*)\}/);
assert.ok(orbitMatch, "module orbit spacing function must be extractable for regression checks");
const moduleOrbitRadius = new Function("count", orbitMatch[1]);
assert.equal(moduleOrbitRadius(0), 330, "collapsed overview should retain the compact module orbit");
assert.ok(moduleOrbitRadius(1) > moduleOrbitRadius(0), "expanding the first module must spread every module anchor outward");
assert.ok(moduleOrbitRadius(4) > moduleOrbitRadius(1), "additional expanded clusters should continue increasing module spacing");
assert.ok(moduleOrbitRadius(11) <= 630, "full expansion spacing must remain bounded");
assert.ok(source.includes("moduleRadius=moduleOrbitRadius(count)"), "scene layout must use the dynamic module orbit radius");

console.log("3D cluster validation passed: deterministic semantic scatter, expanded-module spacing, audited Core friendship retargeting, bubble boundaries, spotlight integration, gestures, and Pages packaging are present.");
