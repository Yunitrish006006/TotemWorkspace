#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphViewModel } from "../intelligence/code-graph.mjs";
import { loadCodeCatalog } from "../intelligence/code-catalog.mjs";
import { loadCodeIndex } from "../intelligence/code-index.mjs";
import { loadKnowledge } from "../intelligence/workspace-knowledge.mjs";

export function renderFlutterGraph({
  knowledge = loadKnowledge(),
  index = loadCodeIndex({ knowledge }),
  outputPath = path.join(knowledge.root, "viewer_flutter", "assets", "graph-data.json")
} = {}) {
  const baseModel = buildGraphViewModel({ knowledge, index });
  const reviewed = loadCodeCatalog(knowledge.root);
  const model = Object.freeze({
    ...baseModel,
    codeCatalog: Object.freeze({
      schemaVersion: reviewed.schemaVersion,
      modules: reviewed.modules
    })
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  return Object.freeze({
    outputPath,
    generatedAt: model.generatedAt,
    modules: model.modules.length,
    features: model.features.length,
    contracts: model.contracts.length,
    sharedCapabilities: model.sharedCapabilities?.length ?? 0,
    codeNodes: model.code?.nodes?.length ?? 0,
    reviewedModules: model.codeCatalog?.modules?.length ?? 0
  });
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(renderFlutterGraph(), null, 2)}\n`);
}
