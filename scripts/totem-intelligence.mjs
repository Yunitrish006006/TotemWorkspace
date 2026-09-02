#!/usr/bin/env node
import { buildCodeIndex, searchCode } from "../intelligence/code-index.mjs";
import { buildContextPack } from "../intelligence/context-pack.mjs";
import { defaultReposRoot, graphForModule, impactAnalysis, knowledgeSummary, loadKnowledge, resolveTask, testPlan, workspaceStatus } from "../intelligence/workspace-knowledge.mjs";

function parseList(value) {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const [command, ...args] = process.argv.slice(2);
const knowledge = loadKnowledge();

switch (command) {
  case "summary":
    print(knowledgeSummary(knowledge));
    break;
  case "resolve":
    print(resolveTask(args.join(" "), knowledge));
    break;
  case "graph":
    print(graphForModule(args[0], { depth: Number(args[1] || 1), knowledge }));
    break;
  case "search": {
    const query = args[0] ?? "";
    const modules = parseList(args[1]);
    print(searchCode(query, { knowledge, modules, limit: Number(args[2] || 12) }));
    break;
  }
  case "context": {
    const query = args[0] ?? "";
    const audience = args[1] || "primary";
    const moduleId = args[2] || null;
    const maxTokens = Number(args[3] || 8_000);
    print(buildContextPack(query, { audience, moduleId, maxTokens, knowledge }));
    break;
  }
  case "impact":
    print(impactAnalysis({ changedFiles: parseList(args[0]), changedModules: parseList(args[1]) }, knowledge));
    break;
  case "test-plan":
    print(testPlan({ query: args[0] ?? "", changedModules: parseList(args[1]), changedFiles: parseList(args[2]) }, knowledge));
    break;
  case "status":
    print(workspaceStatus({ knowledge, reposRoot: defaultReposRoot(knowledge.root) }));
    break;
  case "build-index": {
    const index = buildCodeIndex({ knowledge, reposRoot: defaultReposRoot(knowledge.root) });
    print({ generatedAt: index.generatedAt, chunks: index.chunks.length, modules: index.modules });
    break;
  }
  default:
    console.error(`Usage:
  node scripts/totem-intelligence.mjs summary
  node scripts/totem-intelligence.mjs resolve "<task>"
  node scripts/totem-intelligence.mjs graph <totem-module-id> [depth]
  node scripts/totem-intelligence.mjs search "<query>" [module1,module2] [limit]
  node scripts/totem-intelligence.mjs context "<task>" [primary|worker|reviewer] [module-id] [maxTokens]
  node scripts/totem-intelligence.mjs impact "<file1,file2>" "<module1,module2>"
  node scripts/totem-intelligence.mjs test-plan "<task>" "<module1,module2>" "<file1,file2>"
  node scripts/totem-intelligence.mjs status
  node scripts/totem-intelligence.mjs build-index`);
    process.exitCode = 2;
}
