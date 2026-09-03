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
  "function scatter",
  "function drawCluster",
  "clusters.push",
  "feature-detail",
  "shared-capability",
  "window.__TOTEM_CLUSTER_3D__"
]) assert.ok(source.includes(required), `missing cluster behavior: ${required}`);

assert.ok(!source.includes("Math.random"), "cluster positions must remain deterministic across reloads");
assert.ok(source.includes('type==="category"?[.72,.96]'), "generated code must occupy the outer semantic radius band");
assert.ok(source.includes('type==="capability"?[.56,.78]'), "shared capabilities must occupy the middle semantic radius band");
assert.ok(source.includes(':[.34,.64]'), "curated features must occupy the inner semantic radius band");
assert.ok(source.includes("c.radius*p.scale"), "cluster boundary must scale with the same 3D projection as its module");
assert.ok(source.includes("spotOwner"), "spotlight must influence cluster visibility");
assert.ok(source.includes("relatedOwners"), "clusters connected to the spotlight must remain partially emphasized");
assert.ok(source.includes("cam.panX"), "cluster view must preserve camera-center panning");
assert.ok(source.includes("gesture.startZoom"), "cluster view must preserve pinch zoom");

console.log("3D cluster validation passed: deterministic semantic scatter, bubble boundaries, spotlight integration, gestures, and Pages packaging are present.");
