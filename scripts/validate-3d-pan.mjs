#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "graph-v2.html"), "utf8");
const rendererPath = path.join(root, "viewer", "graph-v2-cluster-v2.js");
const obsoleteHelperPath = path.join(root, "viewer", "graph-v2-pan.js");
const source = fs.readFileSync(rendererPath, "utf8");

assert.ok(html.includes("兩指縮放＋平移"), "touch hint must retain two-finger zoom + pan");
assert.ok(html.includes("右鍵拖曳平移"), "desktop hint must expose right-drag pan");
assert.ok(html.includes('src="viewer/graph-v2-cluster-v2.js"'), "active cluster renderer must be v2");
assert.ok(!html.includes('src="viewer/graph-v2-pan.js"'));
assert.ok(!fs.existsSync(obsoleteHelperPath), "obsolete CSS-transform pan helper must be removed");
assert.ok(source.includes("panX: 0, panY: 0"));
assert.ok(source.includes("function centroid"));
assert.ok(source.includes("function panBy"));
assert.ok(source.includes("cam.panX = clamp"));
assert.ok(source.includes("cam.panY = clamp"));
assert.ok(source.includes("width / 2 + cam.panX + x * scale"));
assert.ok(source.includes("height / 2 + cam.panY + y * scale"));
assert.ok(source.includes('event.button === 2 ? "pan" : "rotate"'));
assert.ok(source.includes('pointer.mode === "pan"'));
assert.ok(source.includes('canvas.addEventListener("contextmenu"'));
assert.ok(!source.includes("canvas.style.transform"));
assert.ok(!source.includes("translate3d("));
assert.doesNotThrow(() => new Function(source));

const projectMatch = source.match(/function project\(point, width, height\) \{([\s\S]*?)\n  \}/);
assert.ok(projectMatch, "project() must remain available for camera projection validation");
const projectSource = `function project(point, width, height) {${projectMatch[1]}\n  }`;
const context = vm.createContext({ Math, cam: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 } });
new vm.Script(`${projectSource};this.project=project;`).runInContext(context);
const base = context.project({ x: 0, y: 0, z: 0 }, 1000, 700);
context.cam.panX = 120;
context.cam.panY = -45;
const shifted = context.project({ x: 0, y: 0, z: 0 }, 1000, 700);
assert.equal(shifted.x - base.x, 120, "camera panX must shift the projected world center, not the canvas element");
assert.equal(shifted.y - base.y, -45, "camera panY must shift the projected world center, not the canvas element");

console.log("3D camera pan validation passed: touch two-finger pan and desktop right-drag both change projection center while the canvas DOM remains fixed.");
