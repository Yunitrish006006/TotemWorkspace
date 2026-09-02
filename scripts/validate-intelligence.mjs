#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { buildGraphViewModel } from "../intelligence/code-graph.mjs";
import { buildCodeIndex, refreshCodeIndex, searchCode } from "../intelligence/code-index.mjs";
import { buildContextPack } from "../intelligence/context-pack.mjs";
import { graphForModule, knowledgeSummary, loadKnowledge, resolveTask, testPlan } from "../intelligence/workspace-knowledge.mjs";
import { renderGraphV2 } from "./render-graph-v2.mjs";

const knowledge = loadKnowledge();
const summary = knowledgeSummary(knowledge);
assert.equal(summary.moduleCount, 11, "intelligence graph must contain 11 active Totem modules");
assert.equal(summary.featureCount, 58, "intelligence graph must derive all 58 feature branches from index.html");

const counts = knowledge.contracts.reduce((groups, contract) => {
  (groups[contract.type] ??= []).push(contract);
  return groups;
}, Object.create(null));
assert.equal(counts["hard-core"]?.length, 10, "all non-Core modules must have one hard Core dependency edge");
assert.equal(counts["fabric-suggests"]?.length, 3, "graph must contain 3 Fabric suggests contracts");
assert.equal(counts["runtime-optional"]?.length, 8, "graph must contain 8 runtime optional contracts");
assert.equal(counts["external-service"]?.length, 2, "graph must contain 2 external service contracts");
assert.equal(counts.eventbus?.length, 3, "graph must keep 3 EventBus relationships separate from module dependencies");
assert.equal(counts["observer-provider"]?.length, 6, "graph must contain all 6 Observer provider family/protocol contracts");

const death = resolveTask("死亡背包跟 Nexus 死亡節點同步有問題", knowledge);
const deathModules = death.modules.map((module) => module.id);
assert.ok(deathModules.includes("totem-remnant"), "death-backpack query must resolve TotemRemnant");
assert.ok(deathModules.includes("totem-nexus"), "death-node query must resolve TotemNexus");
assert.ok(death.contracts.some((contract) => contract.id === "remnant-nexus"), "death query must surface remnant-nexus contract");

const nesting = resolveTask("銅魁儡把 Remnant 背包塞進另一個背包，修正防巢狀", knowledge);
const nestingModules = nesting.modules.map((module) => module.id);
assert.ok(nestingModules.includes("totem-automata"), "copper-golem query must resolve TotemAutomata");
assert.ok(nestingModules.includes("totem-remnant"), "backpack anti-nesting query must resolve TotemRemnant");
assert.ok(nesting.contracts.some((contract) => contract.id === "automata-remnant"), "anti-nesting query must surface automata-remnant contract");

const coreGraph = graphForModule("totem-core", { depth: 1, knowledge });
assert.equal(coreGraph.modules.length, 11, "Core depth-1 graph must include every active Totem module");

const observerPlan = testPlan({ query: "修改 Observer Screen provider protocol" }, knowledge);
assert.ok(observerPlan.validationCategories.includes("client-gametest"), "Observer work must require client GameTest coverage");
assert.ok(observerPlan.validationCategories.includes("privacy-redaction"), "Observer work must require privacy-redaction coverage");

const pack = buildContextPack("死亡背包跟 Nexus 同步有問題", { audience: "primary", maxTokens: 4000, knowledge });
assert.ok(pack.modules.some((module) => module.id === "totem-remnant"), "primary context pack must contain the owner module");
assert.ok(pack.rendered.length > 0, "context pack must render bounded JSON text");
assert.ok(pack.codeIndex.freshness, "context pack must report code-index freshness state");

function validateIncrementalIndex() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "totem-intelligence-"));
  const repoRoot = path.join(tempRoot, "TotemRemnant");
  const sourceDir = path.join(repoRoot, "src", "main", "java", "dev", "totem", "remnant");
  const sourceFile = path.join(sourceDir, "IncrementalProbe.java");
  const indexPath = path.join(tempRoot, "code-index.json");

  try {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(sourceFile, "package dev.totem.remnant;\npublic final class BeforeRefreshMarker {}\n", "utf8");

    const initial = buildCodeIndex({ knowledge, reposRoot: tempRoot, outputPath: indexPath });
    assert.equal(initial.schemaVersion, 2, "code index must use schema v2 with per-file freshness metadata");
    assert.ok(initial.fileStates.some((entry) => entry.moduleId === "totem-remnant" && entry.path.endsWith("IncrementalProbe.java")), "full index must record indexed file state");

    const before = searchCode("BeforeRefreshMarker", {
      knowledge,
      modules: ["totem-remnant"],
      reposRoot: tempRoot,
      indexPath
    });
    assert.ok(before.results.some((result) => result.path.endsWith("IncrementalProbe.java")), "initial code search must find the indexed probe");

    fs.writeFileSync(sourceFile, "package dev.totem.remnant;\npublic final class AfterIncrementalRefreshMarkerWithDifferentSize {}\n", "utf8");
    const after = searchCode("AfterIncrementalRefreshMarkerWithDifferentSize", {
      knowledge,
      modules: ["totem-remnant"],
      reposRoot: tempRoot,
      indexPath
    });
    assert.equal(after.freshness.mode, "incremental", "search must incrementally refresh a modified selected module before retrieval");
    assert.ok(after.freshness.refreshedModules.includes("totem-remnant"), "incremental refresh must report the touched module");
    assert.ok(after.freshness.changedFiles.some((entry) => entry.endsWith("IncrementalProbe.java")), "incremental refresh must report the modified file");
    assert.ok(after.results.some((result) => result.path.endsWith("IncrementalProbe.java")), "search after edit must retrieve the new file content");

    fs.rmSync(sourceFile);
    const removed = refreshCodeIndex({ knowledge, reposRoot: tempRoot, indexPath, modules: ["totem-remnant"] });
    assert.equal(removed.freshness.mode, "incremental", "deleting an indexed file must trigger incremental refresh");
    assert.ok(removed.freshness.removedFiles.some((entry) => entry.endsWith("IncrementalProbe.java")), "incremental refresh must report deleted indexed files");
    assert.ok(!removed.index.chunks.some((chunk) => chunk.moduleId === "totem-remnant" && chunk.path.endsWith("IncrementalProbe.java")), "deleted source chunks must be removed from the index");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function validateV2Graph() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "totem-graph-v2-"));
  const outputPath = path.join(tempRoot, "graph-v2.html");
  const outputPath2 = path.join(tempRoot, "graph-v2-repeat.html");
  const sourceBodyMarker = "SOURCE_BODY_MUST_NEVER_APPEAR_IN_GRAPH_VIEW_MODEL";
  const syntheticIndex = {
    schemaVersion: 2,
    generatedAt: "2026-09-03T00:00:00.000Z",
    workspaceSnapshot: knowledge.snapshot,
    reposRoot: tempRoot,
    modules: knowledge.modules.map((module) => ({
      id: module.id,
      repoName: module.repoName,
      present: module.id === "totem-remnant",
      head: null,
      branch: null,
      worktreeFingerprint: null,
      files: module.id === "totem-remnant" ? 1 : 0,
      chunks: module.id === "totem-remnant" ? 1 : 0
    })),
    fileStates: [{
      moduleId: "totem-remnant",
      repoName: "TotemRemnant",
      path: "src/main/java/dev/totem/remnant/api/GeneratedGraphProbeApi.java",
      size: 123,
      mtimeMs: 1,
      sha256: "synthetic"
    }],
    chunks: [{
      id: "synthetic-chunk",
      moduleId: "totem-remnant",
      repoName: "TotemRemnant",
      path: "src/main/java/dev/totem/remnant/api/GeneratedGraphProbeApi.java",
      startLine: 1,
      endLine: 20,
      symbols: ["GeneratedGraphProbeApi", "verifyGraphProbe"],
      text: sourceBodyMarker
    }]
  };

  try {
    const model = buildGraphViewModel({ knowledge, index: syntheticIndex });
    assert.equal(model.modules.length, 11, "V2 view model must retain all 11 validated modules");
    assert.equal(model.features.length, 58, "V2 view model must retain all 58 curated feature branches");
    assert.equal(model.contracts.length, 32, "V2 view model must retain all 32 validated contracts");
    assert.equal(model.generatedAt, syntheticIndex.generatedAt, "V2 generated timestamp must follow the source index instead of changing on every render");
    assert.ok(model.code.nodes.some((node) => node.type === "code-file" && node.path.endsWith("GeneratedGraphProbeApi.java")), "V2 generated detail must expose factual source-file metadata");
    assert.ok(model.code.nodes.some((node) => node.type === "code-symbol" && node.label === "GeneratedGraphProbeApi"), "V2 generated detail must expose factual indexed symbols");
    assert.ok(model.code.nodes.some((node) => node.type === "code-category" && node.category === "api"), "V2 generated detail must classify API source without redefining architecture contracts");
    assert.ok(!JSON.stringify(model).includes(sourceBodyMarker), "V2 graph view model must never expose indexed source text");

    const rendered = renderGraphV2({ knowledge, index: syntheticIndex, outputPath });
    renderGraphV2({ knowledge, index: syntheticIndex, outputPath: outputPath2 });
    const html = fs.readFileSync(outputPath, "utf8");
    const htmlRepeated = fs.readFileSync(outputPath2, "utf8");
    assert.equal(rendered.modules, 11, "V2 renderer must report 11 modules");
    assert.equal(htmlRepeated, html, "Rendering an unchanged index twice must be deterministic and must not create timestamp-only Git churn");
    assert.ok(html.includes("TOTEM Architecture V2"), "V2 renderer must emit the layered architecture viewer");
    assert.ok(html.includes("3D 預覽"), "V2 viewer must expose the optional 3D preview control");
    assert.ok(html.includes("3D 僅是展示層，不參與 MCP/RAG/驗證"), "V2 viewer must state the 3D isolation boundary");
    assert.ok(!html.includes("__TOTEM_GRAPH_DATA__"), "V2 renderer must replace the data placeholder");
    assert.ok(!html.includes(sourceBodyMarker), "V2 HTML must not contain code-index source bodies");
    assert.ok(!/<script[^>]+src=|<link[^>]+href=/i.test(html), "V2 viewer must be self-contained without external CDN scripts or styles");
    assert.ok(html.includes("function overviewPath"), "V2 2D viewer must use the layered rail router to reduce backward-growing lines");
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
    assert.ok(scriptMatch, "V2 viewer must contain one self-contained inline script");
    assert.doesNotThrow(() => new Function(scriptMatch[1]), "V2 inline viewer JavaScript must parse successfully");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

validateIncrementalIndex();
validateV2Graph();

async function validateMcpServer() {
  const child = spawn(process.execPath, ["mcp/server.mjs"], {
    cwd: knowledge.root,
    env: { ...process.env, TOTEM_WORKSPACE_ROOT: knowledge.root },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(String(message.id));
    if (!waiter) return;
    pending.delete(String(message.id));
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  const request = (id, method, params = undefined) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(String(id));
      reject(new Error(`MCP ${method} timed out${stderr ? `: ${stderr.trim()}` : ""}`));
    }, 5000);
    timer.unref();
    pending.set(String(id), {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
  });

  try {
    const initialized = await request(1, "initialize", {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "TotemWorkspace validation", version: "1" },
      capabilities: {}
    });
    assert.equal(initialized.serverInfo?.name, "totem-workspace-intelligence", "MCP server must identify itself");
    assert.equal(initialized.serverInfo?.version, "0.3.0", "MCP server version must expose incremental-refresh plus isolated V2 graph generation");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

    const listed = await request(2, "tools/list", {});
    const names = (listed.tools ?? []).map((tool) => tool.name);
    for (const required of ["resolve_task", "search", "context_pack", "impact", "test_plan", "workspace_status", "refresh_index"]) {
      assert.ok(names.includes(required), `MCP tool list must include ${required}`);
    }

    const called = await request(3, "tools/call", {
      name: "resolve_task",
      arguments: { query: "死亡背包跟 Nexus 同步" }
    });
    assert.equal(called.isError, false, "MCP resolve_task call must succeed");
    assert.ok(called.structuredContent?.modules?.some((module) => module.id === "totem-remnant"), "MCP resolve_task must return TotemRemnant");
  } finally {
    lines.close();
    if (!child.killed) child.kill("SIGTERM");
  }
}

await validateMcpServer();
console.log(`Totem workspace intelligence validation passed: ${summary.moduleCount} modules, ${summary.featureCount} features, ${summary.contractCount} contracts; incremental index refresh and isolated V2 graph generation passed.`);
