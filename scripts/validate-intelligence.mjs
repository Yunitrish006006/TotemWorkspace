#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildContextPack } from "../intelligence/context-pack.mjs";
import { graphForModule, knowledgeSummary, loadKnowledge, resolveTask, testPlan } from "../intelligence/workspace-knowledge.mjs";

const knowledge = loadKnowledge();
const summary = knowledgeSummary(knowledge);
assert.equal(summary.moduleCount, 11, "intelligence graph must contain 11 active Totem modules");
assert.equal(summary.featureCount, 58, "intelligence graph must derive all 58 feature branches from index.html");

const counts = Object.groupBy(knowledge.contracts, (contract) => contract.type);
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

console.log(`Totem workspace intelligence validation passed: ${summary.moduleCount} modules, ${summary.featureCount} features, ${summary.contractCount} contracts.`);
