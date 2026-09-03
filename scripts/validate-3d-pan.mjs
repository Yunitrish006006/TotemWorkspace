#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "graph-v2.html"), "utf8");
const source = fs.readFileSync(path.join(root, "viewer", "graph-v2-pan.js"), "utf8");

assert.ok(html.includes('src="viewer/graph-v2-pan.js"'));
assert.ok(html.indexOf('src="viewer/graph-v2.js"') < html.indexOf('src="viewer/graph-v2-pan.js"'));
assert.ok(html.includes("兩指縮放＋平移觀看位置"));
assert.doesNotThrow(() => new Function(source));

const listeners = new Map();
const canvas = {
  clientWidth: 1000,
  clientHeight: 700,
  style: {},
  addEventListener(type, handler) {
    listeners.set(type, handler);
  }
};
const context = vm.createContext({
  window: {},
  document: {
    getElementById(id) {
      return id === "graph3d" ? canvas : null;
    }
  },
  Map,
  Math
});
new vm.Script(source, { filename: "graph-v2-pan.js" }).runInContext(context);

function event(pointerId, clientX, clientY) {
  return { pointerId, pointerType: "touch", clientX, clientY, preventDefault() {} };
}

listeners.get("pointerdown")(event(1, 100, 100));
listeners.get("pointermove")(event(1, 130, 120));
assert.equal(canvas.style.transform, undefined, "one-finger movement must not pan the viewport");

listeners.get("pointerdown")(event(2, 200, 100));
listeners.get("pointermove")(event(1, 150, 130));
listeners.get("pointermove")(event(2, 220, 110));
assert.equal(canvas.style.transform, "translate3d(20.0px,10.0px,0)", "two-finger centroid movement pans the 3D viewport");

listeners.get("pointerup")(event(2, 220, 110));
listeners.get("pointermove")(event(1, 190, 170));
assert.equal(canvas.style.transform, "translate3d(20.0px,10.0px,0)", "pan stops when fewer than two pointers remain");

console.log("3D gesture pan validation passed: one-finger rotation path remains untouched and two-finger centroid movement pans the viewport.");
