#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const pages = fs.readFileSync(".github/workflows/pages.yml", "utf8");
const flutterWorkflow = fs.readFileSync(".github/workflows/flutter-viewer.yml", "utf8");
const host = fs.readFileSync("viewer_flutter/lib/widgets/workspace_graph_host.dart", "utf8");
const graphData = fs.readFileSync("viewer_flutter/lib/model/graph_data.dart", "utf8");
const codeGraph = fs.readFileSync("intelligence/code-graph.mjs", "utf8");
const inventory = fs.readFileSync("intelligence/code-inventory.mjs", "utf8");

assert.ok(
  pages.includes("flutter build web --wasm --base-href /TotemWorkspace/"),
  "Pages must build Flutter for the repository root path"
);
assert.ok(
  flutterWorkflow.includes("flutter build web --wasm --base-href /TotemWorkspace/"),
  "Flutter CI must validate the same root base href used by Pages"
);
assert.ok(pages.includes("cp -R viewer_flutter/build/web/. _site/"), "Flutter build must own the Pages root");
assert.ok(!pages.includes("cp graph-v2.html _site/index.html"), "legacy JavaScript shell must not replace Flutter at the Pages root");
assert.ok(pages.includes("cp graph-v2.html _site/legacy/index.html"), "legacy JavaScript viewer must remain available for rollback/debugging");
assert.ok(
  pages.includes("cp viewer/graph-v2-cluster-v2.js _site/legacy/viewer/graph-v2-cluster-v2.js"),
  "legacy rollback surface must package the current standalone JS renderer"
);

assert.ok(host.includes("PUBLISHED SNAPSHOT · FLUTTER ROOT"), "Flutter UI must identify the production-root mode");
assert.ok(host.includes("程式碼盤點"), "Flutter root must expose the code-first inventory surface");
assert.ok(graphData.includes("GraphCodeInventory codeInventory"), "Flutter graph model must parse the code-first inventory");
assert.ok(codeGraph.includes("buildCodeInventory"), "graph generation must attach the code-first inventory");
assert.ok(inventory.includes('sourceScope: "production-code-only"'), "inventory provenance must be production-code-only");
assert.ok(inventory.includes('value.startsWith("src/main/") || value.startsWith("src/client/")'), "inventory must only admit production source roots");
assert.ok(!inventory.includes("README.md"), "code-first inventory implementation must not use README evidence");

console.log("Flutter production-root validation passed: Flutter owns Pages root, JS is isolated under /legacy/, and production-code-only inventory is exposed.");
