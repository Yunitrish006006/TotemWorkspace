#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphViewModel } from "../intelligence/code-graph.mjs";
import { loadCodeIndex } from "../intelligence/code-index.mjs";
import { loadKnowledge } from "../intelligence/workspace-knowledge.mjs";

export function renderFlutterGraph({
  knowledge = loadKnowledge(),
  index = loadCodeIndex({ knowledge }),
  outputPath = path.join(knowledge.root, "viewer_flutter", "assets", "graph-data.json")
} = {}) {
  const model = buildGraphViewModel({ knowledge, index });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  return Object.freeze({
    outputPath,
    generatedAt: model.generatedAt,
    modules: model.modules.length,
    features: model.features.length,
    contracts: model.contracts.length,
    sharedCapabilities: model.sharedCapabilities?.length ?? 0,
    codeNodes: model.code?.nodes?.length ?? 0
  });
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(renderFlutterGraph(), null, 2)}\n`);
}
