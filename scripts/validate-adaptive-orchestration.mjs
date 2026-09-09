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


const small = buildOrchestrationPlan({ query: "local copy typo", moduleId: "totem-alpha", knowledge });
assert.equal(small.schemaVersion, 2);
assert.equal(small.assignments, undefined);
assert.equal(small.mode, undefined);
assert.equal(small.execution.maxConcurrentWrites, 1);
assert.equal(small.contextHints.modelPreference, "lightweight-preferred");
assert.equal(small.execution.sharedContractStabilizationRequired, false);
assert.equal(small.independentReviewRequired, false); // Merely having consumers does not mean a local typo changes their contract.
assert.ok(small.writeScope.every((scope) => scope.moduleId === "totem-alpha"));
assert.ok(small.readScope.some((scope) => scope.moduleId === "totem-beta"));

const isolatedKnowledge = { ...knowledge, contracts: [], contractById: new Map(), features: [], featureById: new Map() };
const isolated = buildOrchestrationPlan({ query: "small typo", moduleId: "totem-alpha", knowledge: isolatedKnowledge });
assert.equal(isolated.contextHints.modelPreference, "lightweight-preferred");
assert.equal(isolated.independentReviewRequired, false);
assert.equal(isolated.waves.length, 3);
assert.ok(isolated.waves.every((wave) => wave.contextBudget <= 8000));
const medium = buildOrchestrationPlan({ query: "module-local rendering fix", moduleId: "totem-beta", knowledge: isolatedKnowledge });
assert.deepEqual(medium.writeScope.map((entry) => entry.moduleId), ["totem-beta"]);
assert.ok(medium.requiredValidation.validationCategories.includes("unit-tests"));
assert.equal(medium.contextHints.modelPreference, "lightweight-preferred");

const shared = buildOrchestrationPlan({ query: "Observer client server protocol", changedModules: ["totem-core", "totem-gamma"], knowledge });
assert.equal(shared.execution.sharedContractStabilizationRequired, true);
assert.equal(shared.execution.maxConcurrentWrites, 1);
assert.equal(shared.independentReviewRequired, true);
assert.ok(shared.impactedConsumers.includes("totem-gamma"));
assert.deepEqual(shared.waves.find((wave) => wave.id === "consumer-update").dependsOn, ["shared-contract"]);
assert.ok(shared.waves.find((wave) => wave.id === "shared-contract").modules.includes("totem-core"));
assert.ok(shared.requiredValidation.validationCategories.includes("client-gametest"));
assert.equal(shared.contextHints.modelPreference, "strong-reasoning-preferred");

const parallel = buildOrchestrationPlan({ query: "independent mechanical edits", changedModules: ["totem-alpha", "totem-beta"], knowledge: isolatedKnowledge });
assert.equal(parallel.execution.parallelismAllowed, true);
assert.equal(parallel.execution.maxConcurrentWrites, 2);
assert.equal(parallel.execution.overlappingWritesAllowed, false);
assert.ok(parallel.waves.find((wave) => wave.id === "implementation").parallelizable);
assert.equal(parallel.optimization.secondaryGoal, "minimize-total-model-tokens");
assert.equal(parallel.optimization.preferSequentialWhenCheaper, true);

const highRisk = buildOrchestrationPlan({ query: "network persistence corruption", moduleId: "totem-alpha", knowledge: isolatedKnowledge });
assert.equal(highRisk.contextHints.modelPreference, "strong-reasoning-preferred");
assert.equal(highRisk.independentReviewRequired, true);
assert.ok(highRisk.requiredValidation.validationCategories.includes("build"));
assert.ok(highRisk.contextHints.escalationAllowed);

for (const surface of ["web", "discord", "cli", "ide", "bridge", "sibling"]) {
  assert.deepEqual(buildOrchestrationPlan({ query: "same focused work", moduleId: "totem-alpha", knowledge: isolatedKnowledge, surface }),
    buildOrchestrationPlan({ query: "same focused work", moduleId: "totem-alpha", knowledge: isolatedKnowledge }));
}
const tooling = buildOrchestrationPlan({ query: "Refactor TotemWorkspace orchestration Web Discord runtime", knowledge });
assert.deepEqual(tooling.affectedModules, ["totem-workspace"]);
assert.deepEqual(tooling.writeScope, [{ moduleId: "totem-workspace", paths: ["TotemWorkspace/**"] }]);
assert.ok(tooling.requiredValidation.validationCategories.includes("agent-adapter-validation"));
assert.equal(orchestrationPlanSummary(shared).execution.maxConcurrentWrites, 1);
assert.equal(orchestrationPlanSummary(shared).roles, undefined);
console.log("Execution constraint validation passed: isolated/medium/shared/parallel/high-risk tasks, tooling routing, surface parity, token preferences and topology freedom.");


const { createExecutionState, acquireWrite, releaseWrite, completeWave, executionSnapshot } = await import("../intelligence/execution-constraints.mjs");
const state = createExecutionState(parallel, { reposRoot: "/tmp/totem-execution-test" });
assert.throws(() => acquireWrite(state, { moduleId: "totem-alpha", path: "totemalpha/File.java", waveId: "implementation", leaseId: "early" }), /dependencies/);
completeWave(state, "discovery", { reference: "bounded evidence" });
assert.throws(() => acquireWrite(state, { moduleId: "totem-alpha", path: "../File.java", waveId: "implementation", leaseId: "escape" }), /Invalid/);
assert.throws(() => acquireWrite(state, { moduleId: "totem-alpha", path: "totembeta/File.java", waveId: "implementation", leaseId: "wrong-module" }), /scope/);
acquireWrite(state, { moduleId: "totem-alpha", path: "totemalpha/File.java", waveId: "implementation", leaseId: "a" });
assert.throws(() => acquireWrite(state, { moduleId: "totem-alpha", path: "totemalpha/Other.java", waveId: "implementation", leaseId: "overlap" }), /Overlapping/);
acquireWrite(state, { moduleId: "totem-beta", path: "totembeta/File.java", waveId: "implementation", leaseId: "b" });
assert.throws(() => acquireWrite(state, { moduleId: "totem-alpha", path: "totemalpha/Third.java", waveId: "implementation", leaseId: "overflow" }), /Maximum/);
assert.throws(() => completeWave(state, "implementation", { reference: "diff" }), /active writes/);
releaseWrite(state, "a"); releaseWrite(state, "b");
completeWave(state, "implementation", { reference: "diff" });
assert.throws(() => completeWave(state, "verification", { reference: "reasoning only" }), /Impact/);
completeWave(state, "verification", { reference: "logs", impact: "impact result", testPlan: "plan result", consumerInspection: "checked", validations: parallel.requiredValidation.validationCategories.map((category) => ({ category, status: "passed", exitCode: 0, command: "actual fixture command", reference: "log" })) });
assert.throws(() => completeWave(state, "independent-review", { reference: "self review", independent: true, reviewer: "same", implementers: ["same"] }), /independent review/);
completeWave(state, "independent-review", { reference: "review evidence", independent: true, reviewer: "separate", implementers: ["author"] });
assert.equal(executionSnapshot(state).complete, true);
const guardedState = createExecutionState(shared);
completeWave(guardedState, "discovery", { reference: "consumer map" });
assert.throws(() => completeWave(guardedState, "shared-contract", { reference: "not stabilized" }), /stabilization/);
completeWave(guardedState, "shared-contract", { reference: "contract decision", stabilized: true });
console.log("Execution enforcement passed: scope, ownership, concurrency, dependency, stabilization, validation and independent review gates.");


const { buildContextPack } = await import("../intelligence/context-pack.mjs");
const focusedPack = buildContextPack("Fix bug", { knowledge: isolatedKnowledge, orchestrationPlan: medium, includeCode: false });
assert.deepEqual(focusedPack.routing.modules, medium.affectedModules);
assert.deepEqual(focusedPack.validation, medium.requiredValidation);
console.log("Precomputed plan context reuses authoritative read scope and validation.");

assert.deepEqual(buildOrchestrationPlan({ query: tooling.query, moduleId: "totem-core", knowledge }), tooling, "Sibling cwd focus must not add game-module writes to workspace tooling tasks");
