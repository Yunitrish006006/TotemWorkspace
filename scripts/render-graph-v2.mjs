#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderFlutterGraph } from "./render-flutter-graph.mjs";

// Compatibility entry point for existing intelligence/runtime callers.
// The legacy browser JavaScript viewer has been removed; graph generation now
// targets the Flutter asset exclusively.
export function renderGraphV2(options = {}) {
  return renderFlutterGraph(options);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(renderGraphV2(), null, 2)}\n`);
}
