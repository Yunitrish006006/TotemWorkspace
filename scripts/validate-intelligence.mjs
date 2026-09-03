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
assert.deepEqual([summary.moduleCount, summary.featureCount, summary.contractCount], [11, 58, 32]);

const grouped = knowledge.contracts.reduce((out, c) => ((out[c.type] ??= []).push(c), out), {});
assert.deepEqual([
  grouped["hard-core"]?.length,
  grouped["fabric-suggests"]?.length,
  grouped["runtime-optional"]?.length,
  grouped["external-service"]?.length,
  grouped.eventbus?.length,
  grouped["observer-provider"]?.length
], [10, 3, 8, 2, 3, 6]);

const death = resolveTask("死亡背包跟 Nexus 死亡節點同步有問題", knowledge);
assert.ok(death.modules.some((m) => m.id === "totem-remnant"));
assert.ok(death.modules.some((m) => m.id === "totem-nexus"));
assert.ok(death.contracts.some((c) => c.id === "remnant-nexus"));
const nesting = resolveTask("銅魁儡把 Remnant 背包塞進另一個背包，修正防巢狀", knowledge);
assert.ok(nesting.modules.some((m) => m.id === "totem-automata"));
assert.ok(nesting.modules.some((m) => m.id === "totem-remnant"));
assert.ok(nesting.contracts.some((c) => c.id === "automata-remnant"));
assert.equal(graphForModule("totem-core", { depth: 1, knowledge }).modules.length, 11);
const observerPlan = testPlan({ query: "修改 Observer Screen provider protocol" }, knowledge);
assert.ok(observerPlan.validationCategories.includes("client-gametest"));
assert.ok(observerPlan.validationCategories.includes("privacy-redaction"));
const pack = buildContextPack("死亡背包跟 Nexus 同步有問題", { audience: "primary", maxTokens: 4000, knowledge });
assert.ok(pack.modules.some((m) => m.id === "totem-remnant"));
assert.ok(pack.rendered.length > 0);
assert.ok(pack.codeIndex.freshness);

function validateIncrementalIndex() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "totem-index-"));
  const dir = path.join(root, "TotemRemnant", "src", "main", "java", "dev", "totem", "remnant");
  const source = path.join(dir, "IncrementalProbe.java");
  const indexPath = path.join(root, "code-index.json");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(source, "package dev.totem.remnant;\npublic final class BeforeRefreshMarker {}\n");
    const initial = buildCodeIndex({ knowledge, reposRoot: root, outputPath: indexPath });
    assert.equal(initial.schemaVersion, 2);
    assert.ok(searchCode("BeforeRefreshMarker", { knowledge, modules: ["totem-remnant"], reposRoot: root, indexPath }).results.length);

    fs.writeFileSync(source, "package dev.totem.remnant;\npublic final class AfterIncrementalRefreshMarkerWithDifferentSize {}\n");
    const after = searchCode("AfterIncrementalRefreshMarkerWithDifferentSize", { knowledge, modules: ["totem-remnant"], reposRoot: root, indexPath });
    assert.equal(after.freshness.mode, "incremental");
    assert.ok(after.freshness.refreshedModules.includes("totem-remnant"));
    assert.ok(after.results.some((r) => r.path.endsWith("IncrementalProbe.java")));

    fs.rmSync(source);
    const removed = refreshCodeIndex({ knowledge, reposRoot: root, indexPath, modules: ["totem-remnant"] });
    assert.ok(removed.freshness.removedFiles.some((p) => p.endsWith("IncrementalProbe.java")));
    assert.ok(!removed.index.chunks.some((c) => c.path.endsWith("IncrementalProbe.java")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function validateV2Graph() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "totem-v2-"));
  const one = path.join(root, "graph-data.js");
  const two = path.join(root, "graph-data-repeat.js");
  const marker = "SOURCE_BODY_MUST_NEVER_APPEAR_IN_GRAPH_VIEW_MODEL";
  const index = {
    schemaVersion: 2,
    generatedAt: "2026-09-03T00:00:00.000Z",
    workspaceSnapshot: knowledge.snapshot,
    reposRoot: root,
    modules: knowledge.modules.map((m) => ({ id: m.id, repoName: m.repoName, present: ["totem-remnant", "totem-automata"].includes(m.id), head: null, branch: null, worktreeFingerprint: null, files: m.id === "totem-remnant" ? 1 : m.id === "totem-automata" ? 1 : 0, chunks: m.id === "totem-remnant" ? 1 : 0 })),
    fileStates: [
      { moduleId: "totem-remnant", repoName: "TotemRemnant", path: "src/main/java/dev/totem/remnant/api/GeneratedGraphProbeApi.java", size: 123, mtimeMs: 1, sha256: "synthetic" },
      { moduleId: "totem-automata", repoName: "TotemAutomata", path: "src/main/java/dev/totem/automata/manual/AutomataManual.java", size: 321, mtimeMs: 2, sha256: "manual-synthetic" },
      { moduleId: "totem-remnant", repoName: "TotemRemnant", path: "src/gametest/java/dev/totem/remnant/ManualGameTest.java", size: 111, mtimeMs: 3, sha256: "test-manual-synthetic" }
    ],
    chunks: [{ id: "probe", moduleId: "totem-remnant", repoName: "TotemRemnant", path: "src/main/java/dev/totem/remnant/api/GeneratedGraphProbeApi.java", startLine: 1, endLine: 20, symbols: ["GeneratedGraphProbeApi", "verifyGraphProbe"], text: marker }]
  };
  try {
    const model = buildGraphViewModel({ knowledge, index });
    assert.deepEqual([model.modules.length, model.features.length, model.contracts.length], [11, 58, 32]);
    assert.ok(model.code.nodes.some((n) => n.type === "code-file" && n.path.endsWith("GeneratedGraphProbeApi.java")));
    assert.ok(model.code.nodes.some((n) => n.type === "code-symbol" && n.label === "GeneratedGraphProbeApi"));
    assert.ok(model.sharedCapabilities.some((c) => c.id === "shared:manual:totem-automata" && c.providerModuleId === "totem-core"));
    assert.ok(!model.sharedCapabilities.some((c) => c.id === "shared:manual:totem-remnant"));
    assert.ok(!JSON.stringify(model).includes(marker));

    renderGraphV2({ knowledge, index, outputPath: one });
    renderGraphV2({ knowledge, index, outputPath: two });
    const data = fs.readFileSync(one, "utf8");
    assert.equal(data, fs.readFileSync(two, "utf8"));
    assert.ok(data.startsWith("/* AUTO-GENERATED"));
    assert.ok(data.includes("window.__TOTEM_GRAPH_DATA__ = "));
    assert.ok(data.includes("shared:manual:totem-automata"));
    assert.ok(!data.includes(marker));

    const html = fs.readFileSync(path.join(knowledge.root, "graph-v2.html"), "utf8");
    const renderer = fs.readFileSync(path.join(knowledge.root, "viewer", "graph-v2-cluster-v2.js"), "utf8");
    const adapter = fs.readFileSync(path.join(knowledge.root, "viewer", "graph-v2-adapter.js"), "utf8");
    const css = fs.readFileSync(path.join(knowledge.root, "viewer", "graph-v2.css"), "utf8");
    assert.ok(html.includes('src="viewer/generated/graph-data.js"'));
    assert.ok(html.includes('src="viewer/graph-v2-cluster-v2.js"'));
    assert.ok(!html.includes('src="viewer/graph-v2.js"'));
    assert.ok(!fs.existsSync(path.join(knowledge.root, "viewer", "graph-v2.js")));
    assert.ok(!html.includes('id="mode2d"') && !html.includes('id="pane2d"') && !html.includes('id="graph2d"'));
    assert.ok(html.includes('href="viewer/graph-v2.css"'));
    assert.ok(html.includes('id="expandAll3d"'));
    assert.ok(!html.includes("window.__TOTEM_GRAPH_DATA__"));
    assert.ok(!html.includes("totem-remnant") && !html.includes("remnant-nexus"));
    assert.ok(!/<script>([\s\S]*?)<\/script>/i.test(html));
    assert.ok(!/<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i.test(html));
    assert.ok(!/@import\s+["']?https?:\/\/|url\(\s*["']?https?:\/\//i.test(css));
    assert.ok(css.includes("touch-action:none"));
    assert.ok(renderer.includes("function drawArrowhead"));
    assert.ok(renderer.includes("function draw"));
    assert.ok(renderer.includes("function distance"));
    assert.ok(renderer.includes("spotlightId"));
    assert.ok(renderer.includes("function capabilityConsumerEndpoint"));
    assert.ok(renderer.includes("function showContracts"));
    assert.ok(renderer.includes('canvas.addEventListener("keydown"'));
    assert.doesNotThrow(() => new Function(renderer));
    assert.doesNotThrow(() => new Function(adapter));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function validateMcpServer() {
  const child = spawn(process.execPath, ["mcp/server.mjs"], { cwd: knowledge.root, env: { ...process.env, TOTEM_WORKSPACE_ROOT: knowledge.root }, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  lines.on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const waiter = pending.get(String(msg.id));
    if (!waiter) return;
    pending.delete(String(msg.id));
    msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result);
  });
  const request = (id, method, params = undefined) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out${stderr ? `: ${stderr.trim()}` : ""}`)), 5000);
    timer.unref();
    pending.set(String(id), { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
  });
  try {
    const init = await request(1, "initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "TotemWorkspace validation", version: "1" }, capabilities: {} });
    assert.equal(init.serverInfo?.name, "totem-workspace-intelligence");
    assert.equal(init.serverInfo?.version, "0.3.0");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    const listed = await request(2, "tools/list", {});
    const names = (listed.tools ?? []).map((t) => t.name);
    for (const required of ["resolve_task", "search", "context_pack", "impact", "test_plan", "workspace_status", "refresh_index"]) assert.ok(names.includes(required));
    const called = await request(3, "tools/call", { name: "resolve_task", arguments: { query: "死亡背包跟 Nexus 同步" } });
    assert.equal(called.isError, false);
    assert.ok(called.structuredContent?.modules?.some((m) => m.id === "totem-remnant"));
  } finally {
    lines.close();
    if (!child.killed) child.kill("SIGTERM");
  }
}

validateIncrementalIndex();
validateV2Graph();
await validateMcpServer();
console.log(`Totem workspace intelligence validation passed: ${summary.moduleCount} modules, ${summary.featureCount} features, ${summary.contractCount} contracts; incremental index refresh, shared capability evidence, and data-only V2 viewer generation passed.`);
