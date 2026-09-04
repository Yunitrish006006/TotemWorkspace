#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildOrchestrationPlan,
  orchestrationPlanSummary
} from "../intelligence/orchestration-plan.mjs";

function module(id, name = id) {
  return { id, name, role: id, repoName: id.replaceAll("-", "") };
}

const modules = [
  module("totem-alpha"),
  module("totem-beta"),
  module("totem-gamma"),
  module("totem-core")
];

const features = [
  {
    id: "totem-alpha.feature-1",
    ownerId: "totem-alpha",
    title: "Alpha local text",
    summary: "Alpha local text rendering",
    softContractIds: [],
    serviceContractIds: [],
    eventContractIds: []
  },
  {
    id: "totem-beta.feature-1",
    ownerId: "totem-beta",
    title: "Shared sync",
    summary: "Shared sync with Alpha",
    softContractIds: ["alpha-beta"],
    serviceContractIds: [],
    eventContractIds: []
  },
  {
    id: "totem-gamma.feature-1",
    ownerId: "totem-gamma",
    title: "Observer client protocol",
    summary: "Observer client server protocol mirror",
    softContractIds: [],
    serviceContractIds: [],
    eventContractIds: []
  }
];

const contracts = [
  {
    id: "alpha-beta",
    type: "runtime-optional",
    from: "totem-alpha",
    to: "totem-beta",
    feature: "Shared sync between Alpha and Beta",
    featureIds: ["totem-beta.feature-1"]
  },
  {
    id: "observer-gamma",
    type: "observer-provider",
    from: "totem-core",
    to: "totem-gamma",
    feature: "Observer client server protocol",
    featureIds: ["totem-gamma.feature-1"]
  }
];

const knowledge = {
  snapshot: { date: "2026-09-05" },
  modules,
  features,
  contracts,
  aliases: {},
  moduleById: new Map(modules.map((entry) => [entry.id, entry])),
  featureById: new Map(features.map((entry) => [entry.id, entry])),
  contractById: new Map(contracts.map((entry) => [entry.id, entry])),
  testMatrix: {
    defaults: { validation: ["build"] },
    modules: {
      "totem-alpha": { validation: ["build"] },
      "totem-beta": { validation: ["build", "unit-tests"] },
      "totem-gamma": { validation: ["build", "client-gametest"] },
      "totem-core": { validation: ["build", "cross-module-build"] }
    },
    riskRules: [
      {
        match: ["observer", "protocol", "client server"],
        tags: ["observer", "client-server"],
        validation: ["client-gametest", "privacy-redaction"]
      }
    ]
  }
};

const small = buildOrchestrationPlan({
  query: "local copy typo",
  moduleId: "totem-alpha",
  knowledge
});
assert.equal(small.mode, "primary-only");
assert.equal(small.assignments.length, 0);
assert.equal(small.limits.recommendedSubagents, 0);
assert.equal(small.estimatedBenefit, "none");
assert.match(small.fallback.smallTaskRule, /must not spawn/i);

const assisted = buildOrchestrationPlan({
  query: "Shared sync between Alpha and Beta",
  changedModules: ["totem-alpha", "totem-beta"],
  knowledge
});
assert.ok(["assisted", "bounded-parallel"].includes(assisted.mode));
assert.ok(assisted.score >= 3);
assert.ok(assisted.rationale.modules.includes("totem-alpha"));
assert.ok(assisted.rationale.modules.includes("totem-beta"));
assert.ok(assisted.rationale.contractIds.includes("alpha-beta"));
assert.ok(assisted.assignments.some((entry) => ["architect", "explorer"].includes(entry.role)));
assert.ok(assisted.assignments.some((entry) => entry.role === "reviewer"));

const parallel = buildOrchestrationPlan({
  query: "Shared sync Alpha Beta Gamma",
  changedModules: ["totem-alpha", "totem-beta", "totem-gamma"],
  knowledge
});
assert.ok(["bounded-parallel", "guarded-parallel"].includes(parallel.mode));
assert.ok(parallel.assignments.some((entry) => entry.role === "worker"));
assert.ok(parallel.assignments.filter((entry) => entry.role === "worker").length <= 2);
assert.ok(parallel.assignments.length <= 4);
for (const worker of parallel.assignments.filter((entry) => entry.role === "worker")) {
  assert.equal(worker.writeAllowed, true);
  assert.equal(worker.modules.length, 1, "workers must have a single-module write boundary");
}
for (const readOnly of parallel.assignments.filter((entry) => entry.role !== "worker")) {
  assert.equal(readOnly.writeAllowed, false);
}
assert.ok(parallel.executionWaves.some((wave) => wave.phase === "implementation"));
assert.equal(parallel.limits.workerWriteScope, "module-bounded");

const guarded = buildOrchestrationPlan({
  query: "Observer client server protocol in Gamma and Core",
  moduleId: "totem-core",
  changedModules: ["totem-core", "totem-gamma"],
  knowledge
});
assert.equal(guarded.mode, "guarded-parallel");
assert.ok(guarded.score >= 10);
assert.ok(guarded.rationale.highRisks.includes("observer"));
assert.ok(guarded.rationale.highRisks.includes("client-server"));
assert.ok(guarded.rationale.criticalContractIds.includes("observer-gamma"));
assert.equal(guarded.assignments[0].role, "architect");
assert.ok(guarded.assignments.some((entry) => entry.role === "reviewer"));
assert.ok(guarded.assignments.length <= guarded.limits.maxSubagents);

const summary = orchestrationPlanSummary(guarded);
assert.equal(summary.mode, guarded.mode);
assert.equal(summary.score, guarded.score);
assert.equal(summary.subagents, guarded.assignments.length);
assert.ok(summary.roles.includes("architect"));

const source = fs.readFileSync(new URL("../intelligence/orchestration-plan.mjs", import.meta.url), "utf8");
const mcp = fs.readFileSync(new URL("../mcp/server.mjs", import.meta.url), "utf8");
const context = fs.readFileSync(new URL("../intelligence/context-pack.mjs", import.meta.url), "utf8");
const bridge = fs.readFileSync(new URL("./serve-local-viewer.mjs", import.meta.url), "utf8");
const adapter = fs.readFileSync(new URL("../intelligence/agent-adapter.mjs", import.meta.url), "utf8");

for (const fragment of [
  'return "primary-only"',
  'return "assisted"',
  'return "bounded-parallel"',
  'return "guarded-parallel"',
  "MAX_SUBAGENTS = 4",
  "maxParallelWorkers",
  'workerWriteScope: "module-bounded"',
  "whenMultiAgentUnavailable"
]) {
  assert.ok(source.includes(fragment), `orchestration planner contract missing: ${fragment}`);
}
for (const fragment of [
  'name: "orchestration_plan"',
  'enum: ["primary", "explorer", "architect", "worker", "reviewer"]',
  'case "orchestration_plan"',
  'SERVER_VERSION = "0.4.0"'
]) {
  assert.ok(mcp.includes(fragment), `MCP orchestration integration missing: ${fragment}`);
}
for (const fragment of [
  "buildOrchestrationPlan",
  "orchestrationPlanSummary",
  "contextAudience === audience",
  "workers must stay inside their assigned module"
]) {
  assert.ok(context.includes(fragment), `context-pack orchestration integration missing: ${fragment}`);
}
for (const fragment of [
  '"orchestration_planned"',
  'pathname === "/api/orchestration-plan"',
  "buildOrchestrationPlan({",
  "orchestrationPlan: orchestration",
  "orchestrationSchemaVersion: 1"
]) {
  assert.ok(bridge.includes(fragment), `Bridge orchestration integration missing: ${fragment}`);
}
for (const fragment of [
  "TotemWorkspace adaptive orchestration plan",
  "Do not spawn any subagent for a primary-only plan",
  "must not spawn further subagents",
  "orchestrationPlanSummary"
]) {
  assert.ok(adapter.includes(fragment), `Codex orchestration envelope missing: ${fragment}`);
}

console.log("Phase 7 adaptive orchestration validation passed: deterministic complexity scoring, primary-only gating, bounded read/write roles, parallel worker limits, architecture/reviewer gates, MCP/context integration, and Codex fallback instructions are present.");
