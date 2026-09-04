#!/usr/bin/env node
import { buildCodeIndex, refreshCodeIndex, searchCode } from "../intelligence/code-index.mjs";
import { buildContextPack } from "../intelligence/context-pack.mjs";
import { buildOrchestrationPlan } from "../intelligence/orchestration-plan.mjs";
import { defaultReposRoot, graphForModule, impactAnalysis, knowledgeSummary, loadKnowledge, resolveTask, testPlan, workspaceStatus } from "../intelligence/workspace-knowledge.mjs";
import { renderGraphV2 } from "./render-graph-v2.mjs";

function parseList(value) {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeRenderGraph(index = undefined) {
  try {
    return {
      status: "ok",
      regenerated: true,
      ...renderGraphV2({ knowledge, ...(index ? { index } : {}) })
    };
  } catch (error) {
    return {
      status: "warning",
      regenerated: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

const [command, ...args] = process.argv.slice(2);
const knowledge = loadKnowledge();
const reposRoot = defaultReposRoot(knowledge.root);

switch (command) {
  case "summary":
    print(knowledgeSummary(knowledge));
    break;
  case "resolve":
    print(resolveTask(args.join(" "), knowledge));
    break;
  case "orchestrate":
    print(buildOrchestrationPlan({
      query: args[0] ?? "",
      moduleId: args[1] || null,
      changedModules: parseList(args[2]),
      changedFiles: parseList(args[3]),
      knowledge
    }));
    break;
  case "graph":
    print(graphForModule(args[0], { depth: Number(args[1] || 1), knowledge }));
    break;
  case "search": {
    const query = args[0] ?? "";
    const modules = parseList(args[1]);
    const result = searchCode(query, { knowledge, modules, limit: Number(args[2] || 12), reposRoot });
    print(result.freshness && result.freshness.mode !== "fresh"
      ? { ...result, graphPreview: safeRenderGraph() }
      : result);
    break;
  }
  case "context": {
    const query = args[0] ?? "";
    const audience = args[1] || "primary";
    const moduleId = args[2] || null;
    const maxTokens = Number(args[3] || 8_000);
    const pack = buildContextPack(query, { audience, moduleId, maxTokens, knowledge });
    print(pack.codeIndex?.freshness && pack.codeIndex.freshness.mode !== "fresh"
      ? { ...pack, graphPreview: safeRenderGraph() }
      : pack);
    break;
  }
  case "impact": {
    const impact = impactAnalysis({ changedFiles: parseList(args[0]), changedModules: parseList(args[1]) }, knowledge);
    let indexRefresh;
    let graphPreview;
    try {
      const refreshed = refreshCodeIndex({ knowledge, reposRoot, modules: impact.touchedModules });
      indexRefresh = refreshed.freshness;
      graphPreview = safeRenderGraph(refreshed.index);
    } catch (error) {
      indexRefresh = {
        mode: "error",
        reason: "refresh-failed",
        checkedModules: impact.touchedModules,
        refreshedModules: [],
        changedFiles: [],
        removedFiles: [],
        message: error instanceof Error ? error.message : String(error)
      };
      graphPreview = { status: "skipped", regenerated: false, message: "Code-index refresh failed; graph regeneration skipped." };
    }
    print({ ...impact, indexRefresh, graphPreview });
    break;
  }
  case "test-plan":
    print(testPlan({ query: args[0] ?? "", changedModules: parseList(args[1]), changedFiles: parseList(args[2]) }, knowledge));
    break;
  case "status":
    print(workspaceStatus({ knowledge, reposRoot }));
    break;
  case "build-index": {
    const index = buildCodeIndex({ knowledge, reposRoot });
    print({
      generatedAt: index.generatedAt,
      schemaVersion: index.schemaVersion,
      chunks: index.chunks.length,
      modules: index.modules,
      graphPreview: safeRenderGraph(index)
    });
    break;
  }
  case "refresh-index": {
    const modules = parseList(args[0]);
    const refreshed = refreshCodeIndex({ knowledge, reposRoot, modules });
    print({
      generatedAt: refreshed.index.generatedAt,
      schemaVersion: refreshed.index.schemaVersion,
      chunks: refreshed.index.chunks.length,
      freshness: refreshed.freshness,
      graphPreview: safeRenderGraph(refreshed.index)
    });
    break;
  }
  case "render-graph":
    print(safeRenderGraph());
    break;
  default:
    console.error(`Usage:
  node scripts/totem-intelligence.mjs summary
  node scripts/totem-intelligence.mjs resolve "<task>"
  node scripts/totem-intelligence.mjs orchestrate "<task>" [module-id] [changed-modules] [changed-files]
  node scripts/totem-intelligence.mjs graph <totem-module-id> [depth]
  node scripts/totem-intelligence.mjs search "<query>" [module1,module2] [limit]
  node scripts/totem-intelligence.mjs context "<task>" [primary|explorer|architect|worker|reviewer] [module-id] [maxTokens]
  node scripts/totem-intelligence.mjs impact "<file1,file2>" "<module1,module2>"
  node scripts/totem-intelligence.mjs test-plan "<task>" "<module1,module2>" "<file1,file2>"
  node scripts/totem-intelligence.mjs status
  node scripts/totem-intelligence.mjs build-index
  node scripts/totem-intelligence.mjs refresh-index [module1,module2]
  node scripts/totem-intelligence.mjs render-graph`);
    process.exitCode = 2;
}
