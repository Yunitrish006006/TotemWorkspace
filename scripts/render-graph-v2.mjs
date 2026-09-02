#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphViewModel } from "../intelligence/code-graph.mjs";
import { loadCodeIndex } from "../intelligence/code-index.mjs";
import { loadKnowledge } from "../intelligence/workspace-knowledge.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function jsonForScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

export function renderGraphV2({
  knowledge = loadKnowledge(),
  index = loadCodeIndex({ knowledge }),
  templatePath = path.join(knowledge.root, "viewer", "graph-v2-template.html"),
  outputPath = path.join(knowledge.root, "graph-v2.html")
} = {}) {
  const template = fs.readFileSync(templatePath, "utf8");
  if (!template.includes("__TOTEM_GRAPH_DATA__")) throw new Error("graph-v2 template is missing __TOTEM_GRAPH_DATA__ placeholder");
  const model = buildGraphViewModel({ knowledge, index });
  const html = template.replace("__TOTEM_GRAPH_DATA__", jsonForScript(model));
  fs.writeFileSync(outputPath, html, "utf8");
  return Object.freeze({
    outputPath,
    generatedAt: model.generatedAt,
    modules: model.modules.length,
    features: model.features.length,
    contracts: model.contracts.length,
    codeIndexed: model.code.indexed,
    codeNodes: model.code.nodes.length,
    codeEdges: model.code.edges.length
  });
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(renderGraphV2(), null, 2)}\n`);
}
