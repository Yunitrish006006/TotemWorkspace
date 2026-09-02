#!/usr/bin/env node
import readline from "node:readline";
import { buildCodeIndex, refreshCodeIndex, searchCode } from "../intelligence/code-index.mjs";
import { buildContextPack } from "../intelligence/context-pack.mjs";
import { defaultReposRoot, graphForModule, impactAnalysis, knowledgeSummary, loadKnowledge, resolveTask, testPlan, workspaceStatus } from "../intelligence/workspace-knowledge.mjs";

const SERVER_NAME = "totem-workspace-intelligence";
const SERVER_VERSION = "0.2.0";

function jsonSchema(properties, required = []) {
  return { type: "object", additionalProperties: false, properties, required };
}

const TOOLS = Object.freeze([
  {
    name: "resolve_task",
    description: "Resolve a Totem development request to likely modules, feature branches, dependency contracts, risks, and useful subagent roles before broad repository reading.",
    inputSchema: jsonSchema({ query: { type: "string", minLength: 1 } }, ["query"])
  },
  {
    name: "graph",
    description: "Return the dependency/contract neighborhood for one active Totem module.",
    inputSchema: jsonSchema({
      module_id: { type: "string", minLength: 1 },
      depth: { type: "integer", minimum: 1, maximum: 4, default: 1 }
    }, ["module_id"])
  },
  {
    name: "search",
    description: "Search the local code index after graph narrowing. Before searching, the selected modules are checked for source changes and changed file chunks are incrementally refreshed.",
    inputSchema: jsonSchema({
      query: { type: "string", minLength: 1 },
      modules: { type: "array", items: { type: "string" }, default: [] },
      limit: { type: "integer", minimum: 1, maximum: 40, default: 12 }
    }, ["query"])
  },
  {
    name: "context_pack",
    description: "Build a bounded task-specific context pack for the primary coordinator, a module worker, or a reviewer. Code retrieval automatically refreshes changed chunks in the selected modules.",
    inputSchema: jsonSchema({
      query: { type: "string", minLength: 1 },
      audience: { type: "string", enum: ["primary", "worker", "reviewer"], default: "primary" },
      module_id: { type: ["string", "null"], default: null },
      max_tokens: { type: "integer", minimum: 1000, maximum: 40000, default: 8000 },
      include_code: { type: "boolean", default: true }
    }, ["query"])
  },
  {
    name: "impact",
    description: "Analyze changed files/modules against the Totem dependency graph and proactively refresh code-index chunks for directly touched modules before review/validation.",
    inputSchema: jsonSchema({
      changed_files: { type: "array", items: { type: "string" }, default: [] },
      changed_modules: { type: "array", items: { type: "string" }, default: [] }
    })
  },
  {
    name: "test_plan",
    description: "Return validation categories implied by the task, touched modules, and Totem risk rules.",
    inputSchema: jsonSchema({
      query: { type: "string", default: "" },
      changed_modules: { type: "array", items: { type: "string" }, default: [] },
      changed_files: { type: "array", items: { type: "string" }, default: [] }
    })
  },
  {
    name: "workspace_status",
    description: "Compare the TotemWorkspace snapshot with locally present sibling repositories and report branch, HEAD, dirty state, and snapshot drift.",
    inputSchema: jsonSchema({})
  },
  {
    name: "refresh_index",
    description: "Incrementally refresh selected modules in the local code index, or force a complete rebuild. Normal search/context_pack/impact flows already refresh automatically.",
    inputSchema: jsonSchema({
      modules: { type: "array", items: { type: "string" }, default: [] },
      force_full: { type: "boolean", default: false }
    })
  },
  {
    name: "summary",
    description: "Return counts and snapshot metadata for the Totem workspace intelligence graph.",
    inputSchema: jsonSchema({})
  }
]);

function load() {
  return loadKnowledge();
}

function toolResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], structuredContent: value, isError: false };
}

function toolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

function safeRefresh(knowledge, modules) {
  try {
    return refreshCodeIndex({
      knowledge,
      reposRoot: defaultReposRoot(knowledge.root),
      modules
    }).freshness;
  } catch (error) {
    return {
      mode: "error",
      reason: "refresh-failed",
      checkedModules: modules,
      refreshedModules: [],
      changedFiles: [],
      removedFiles: [],
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function callTool(name, args = {}) {
  const knowledge = load();
  switch (name) {
    case "resolve_task":
      return resolveTask(args.query, knowledge);
    case "graph":
      return graphForModule(args.module_id, { depth: args.depth ?? 1, knowledge });
    case "search":
      return searchCode(args.query, { knowledge, modules: args.modules ?? [], limit: args.limit ?? 12 });
    case "context_pack":
      return buildContextPack(args.query, {
        knowledge,
        audience: args.audience ?? "primary",
        moduleId: args.module_id ?? null,
        maxTokens: args.max_tokens ?? 8000,
        includeCode: args.include_code !== false
      });
    case "impact": {
      const impact = impactAnalysis({ changedFiles: args.changed_files ?? [], changedModules: args.changed_modules ?? [] }, knowledge);
      const indexRefresh = safeRefresh(knowledge, impact.touchedModules);
      return { ...impact, indexRefresh };
    }
    case "test_plan":
      return testPlan({ query: args.query ?? "", changedModules: args.changed_modules ?? [], changedFiles: args.changed_files ?? [] }, knowledge);
    case "workspace_status":
      return workspaceStatus({ knowledge, reposRoot: defaultReposRoot(knowledge.root) });
    case "refresh_index": {
      if (args.force_full === true) {
        const index = buildCodeIndex({ knowledge, reposRoot: defaultReposRoot(knowledge.root) });
        return {
          generatedAt: index.generatedAt,
          chunks: index.chunks.length,
          modules: index.modules,
          freshness: {
            mode: "full",
            reason: "forced",
            checkedModules: knowledge.modules.map((module) => module.id),
            refreshedModules: index.modules.filter((module) => module.present).map((module) => module.id),
            changedFiles: null,
            removedFiles: null
          }
        };
      }
      const refreshed = refreshCodeIndex({
        knowledge,
        reposRoot: defaultReposRoot(knowledge.root),
        modules: args.modules ?? []
      });
      return {
        generatedAt: refreshed.index.generatedAt,
        chunks: refreshed.index.chunks.length,
        modules: refreshed.index.modules,
        freshness: refreshed.freshness
      };
    }
    case "summary":
      return knowledgeSummary(knowledge);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function failure(id, code, message, data = undefined) {
  send({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    failure(null, -32700, "Parse error", String(error));
    return;
  }

  const id = Object.hasOwn(request, "id") ? request.id : null;
  const method = request.method;
  try {
    if (method === "initialize") {
      success(id, {
        protocolVersion: request.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
      return;
    }
    if (method === "notifications/initialized" || method === "initialized") return;
    if (method === "ping") {
      success(id, {});
      return;
    }
    if (method === "tools/list") {
      success(id, { tools: TOOLS });
      return;
    }
    if (method === "tools/call") {
      try {
        success(id, toolResult(callTool(request.params?.name, request.params?.arguments ?? {})));
      } catch (error) {
        success(id, toolError(error));
      }
      return;
    }
    if (id !== null) failure(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    if (id !== null) failure(id, -32603, "Internal error", error instanceof Error ? error.message : String(error));
  }
});
