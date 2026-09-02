#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { buildCodeIndex, refreshCodeIndex, searchCode } from "../intelligence/code-index.mjs";
import { buildContextPack } from "../intelligence/context-pack.mjs";
import { graphForModule, knowledgeSummary, loadKnowledge, resolveTask, testPlan } from "../intelligence/workspace-knowledge.mjs";

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

validateIncrementalIndex();

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
    assert.equal(initialized.serverInfo?.version, "0.2.0", "MCP server version must expose incremental-refresh capability");
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
console.log(`Totem workspace intelligence validation passed: ${summary.moduleCount} modules, ${summary.featureCount} features, ${summary.contractCount} contracts; incremental index refresh passed.`);
