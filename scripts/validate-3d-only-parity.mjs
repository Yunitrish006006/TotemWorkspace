#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("graph-v2.html", "utf8");
const source = fs.readFileSync("viewer/graph-v2-cluster-v2.js", "utf8");
const css = fs.readFileSync("viewer/graph-v2.css", "utf8");
const pages = fs.readFileSync(".github/workflows/pages.yml", "utf8");

assert.ok(!fs.existsSync("viewer/graph-v2.js"), "legacy 2D/base renderer must be deleted");
assert.ok(!html.includes("mode2d") && !html.includes("pane2d") && !html.includes("graph2d"), "2D controls and pane must be removed");
assert.ok(!html.includes('src="viewer/graph-v2.js"'), "legacy renderer must not be loaded");
assert.ok(html.includes('src="viewer/graph-v2-cluster-v2.js"'), "standalone 3D renderer must be loaded");
assert.ok(!css.includes(".svg-wrap") && !css.includes(".node rect") && !css.includes(".section-title"), "2D SVG presentation CSS must be removed");
assert.ok(!pages.includes("cp viewer/graph-v2.js"), "Pages must not publish the deleted 2D renderer");

assert.ok(source.includes("drawArrowhead"), "3D relationships must render arrowheads");
assert.ok(source.includes("if (!internal) drawArrowhead"), "directed contract/capability edges must receive arrowheads");
assert.ok(source.includes('title: "Feature groups"'), "3D module info must expose featureGroups metadata");
assert.ok(source.includes('title: "Summary"'), "3D module info must retain curated/code/capability summary counts");
assert.ok(source.includes("function showContracts"), "3D renderer must own the relationship list button");
assert.ok(source.includes("validated contracts"), "3D relationship list must expose the full contract inventory");
assert.ok(source.includes('document.getElementById("snapshot").textContent'), "3D renderer must initialize snapshot metadata");
assert.ok(source.includes('document.getElementById("stats").textContent'), "3D renderer must initialize statistics metadata");

assert.ok(html.includes('tabindex="0"') && html.includes('role="application"'), "3D canvas must be keyboard-focusable");
assert.ok(source.includes('canvas.addEventListener("keydown"'), "3D renderer must implement keyboard navigation");
assert.ok(source.includes('event.key === "ArrowRight"') && source.includes('event.key === "ArrowLeft"'), "arrow keys must navigate nodes");
assert.ok(source.includes('event.key === "Enter" || event.key === " "'), "Enter/Space must activate the focused node");
assert.ok(source.includes("keyboardFocusId"), "keyboard focus must be represented visually in the 3D renderer");
assert.ok(html.includes("鍵盤方向鍵選節點"), "visible help must document keyboard navigation");

console.log("3D-only parity validation passed: directional edges, module metadata, contracts/stats ownership, keyboard navigation, and 2D removal are complete.");
