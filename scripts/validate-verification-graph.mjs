#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";

import {
  activeVerificationPlan,
  buildVerificationGraph,
  isTestPath
} from "../intelligence/verification-graph.mjs";
import {
  loadVerificationState,
  recordVerificationEvent,
  verificationStatePayload
} from "../intelligence/verification-state.mjs";
import {
  mapGitChangesToSemantic,
  semanticSnapshot
} from "../intelligence/change-intelligence.mjs";

const feature = {
  id: "totem-example.feature-1",
  ownerId: "totem-example",
  title: "Brewing Flow",
  summary: "Brewing recipe stability and material progress",
  softContractIds: [],
  serviceContractIds: [],
  eventContractIds: []
};
const contract = {
  id: "api:totem-example:brewing",
  type: "hard-core",
  from: "totem-example",
  to: "totem-core",
  feature: "Brewing API",
  featureIds: [feature.id]
};
const module = {
  id: "totem-example",
  repoName: "TotemExample",
  name: "TotemExample"
};
const knowledge = {
  snapshot: { date: "2026-09-05" },
  modules: [module],
  features: [feature],
  contracts: [contract],
  moduleById: new Map([[module.id, module]]),
  testMatrix: {
    defaults: { validation: ["gradle-build"] },
    modules: {
      "totem-example": {
        validation: ["gametest"],
        notes: "Synthetic fixture verification"
      }
    },
    riskRules: [
      {
        tags: ["observer"],
        validation: ["client-gametest", "three-jvm-e2e"]
      }
    ]
  }
};

const component = {
  id: "component:totem-example:brewing",
  moduleId: "totem-example",
  key: "brewing",
  label: "Brew Engine",
  responsibility: "Brewing recipe stability",
  featureIds: [feature.id],
  symbols: ["BrewEngine"],
  implementationPaths: ["src/main/java/example/BrewEngine.java"]
};
const capability = {
  id: "shared:core-api:brewing:totem-example:1",
  providerModuleId: "totem-core",
  consumerModuleId: "totem-example",
  providerFeatureId: null,
  consumerFeatureId: feature.id
};
const testPath = "src/test/java/example/BrewEngineGameTest.java";
const index = {
  generatedAt: "2026-09-05T00:00:00Z",
  fileStates: [
    {
      moduleId: "totem-example",
      repoName: "TotemExample",
      path: testPath
    },
    {
      moduleId: "totem-example",
      repoName: "TotemExample",
      path: "src/main/java/example/BrewEngine.java"
    }
  ],
  chunks: [
    {
      moduleId: "totem-example",
      repoName: "TotemExample",
      path: testPath,
      symbols: ["BrewEngineGameTest", "brewingRecipeStability"],
      text: "class BrewEngineGameTest { void brewingRecipeStability() { BrewEngine engine; } }"
    }
  ]
};

assert.equal(isTestPath(testPath), true);
assert.equal(isTestPath("src/main/java/example/BrewEngine.java"), false);

const verification = buildVerificationGraph({
  knowledge,
  index,
  components: [component],
  sharedCapabilities: [capability]
});

assert.equal(verification.schemaVersion, 1);
assert.equal(verification.tests.length, 1);
const test = verification.tests[0];
assert.equal(test.id, `test:totem-example:${testPath}`);
assert.equal(test.moduleId, "totem-example");
assert.equal(test.kind, "gametest");
assert.ok(test.featureIds.includes(feature.id), "semantic test must map to its Feature");
assert.ok(test.componentIds.includes(component.id), "semantic test must map to its Component");
assert.ok(test.contractIds.includes(contract.id), "Feature-bound API contract must receive validated-by evidence");
assert.ok(test.capabilityIds.includes(capability.id), "Feature-bound shared API capability must receive validated-by evidence");

for (const target of [feature.id, contract.id, capability.id]) {
  assert.ok(
    verification.relations.some((relation) => relation.from === target && relation.to === test.id && relation.type === "validated-by"),
    `missing validated-by relation for ${target}`
  );
}
assert.ok(
  verification.requirements.some((requirement) =>
    requirement.id === "verification-requirement:totem-example:gradle-build"),
  "default verification requirements must remain requirements rather than fake Test evidence"
);
assert.ok(
  verification.requirements.some((requirement) =>
    requirement.id === "verification-requirement:totem-example:gametest"),
  "module verification requirements must be represented"
);

const activePlan = activeVerificationPlan({
  knowledge,
  changeIntelligence: {
    impact: {
      touchedModules: ["totem-example"],
      impactedModules: ["totem-example"],
      risks: ["observer"]
    }
  }
});
assert.ok(activePlan.requiredCategories.includes("gradle-build"));
assert.ok(activePlan.requiredCategories.includes("gametest"));
assert.ok(activePlan.requiredCategories.includes("client-gametest"));
assert.ok(activePlan.requiredCategories.includes("three-jvm-e2e"));

const graph = {
  generatedAt: index.generatedAt,
  modules: [{ id: "totem-example", name: "TotemExample", version: "1", role: "fixture", featureGroups: [] }],
  features: [feature],
  components: [component],
  contracts: [contract],
  sharedCapabilities: [capability],
  verification
};
const snapshot = semanticSnapshot(graph);
assert.ok(snapshot.entities.some((entry) => entry.id === test.id && entry.type === "test"));
assert.ok(snapshot.entities.some((entry) => entry.id.startsWith("validated-by:") && entry.type === "relation"));

const mapped = mapGitChangesToSemantic([
  {
    moduleId: "totem-example",
    repoName: "TotemExample",
    status: "M",
    path: testPath
  }
], { beforeGraph: graph, afterGraph: graph });
assert.deepEqual(mapped[0].testIds, [test.id]);
assert.ok(mapped[0].featureIds.includes(feature.id));
assert.ok(mapped[0].componentIds.includes(component.id));

const stateRoot = fs.mkdtempSync(`${os.tmpdir()}/totem-verification-`);
try {
  recordVerificationEvent(stateRoot, {
    sequence: 1,
    timestamp: "2026-09-05T00:01:00Z",
    type: "test_started",
    moduleId: "totem-example",
    test: test.id,
    summary: "fixture started"
  });
  recordVerificationEvent(stateRoot, {
    sequence: 2,
    timestamp: "2026-09-05T00:02:00Z",
    type: "test_failed",
    moduleId: "totem-example",
    test: test.id,
    summary: "fixture failed"
  });

  const persisted = loadVerificationState(stateRoot);
  assert.equal(persisted.entries.length, 1, "latest state must replace older state for the same test target");
  assert.equal(persisted.entries[0].status, "failed");

  const payload = verificationStatePayload({
    workspaceRoot: stateRoot,
    knowledge,
    verification,
    changeIntelligence: {
      impact: {
        touchedModules: ["totem-example"],
        impactedModules: ["totem-example"],
        risks: ["observer"]
      }
    }
  });
  assert.equal(payload.summary.failed, 1);
  assert.equal(payload.summary.running, 0);
  for (const target of [test.id, "totem-example", feature.id, component.id, contract.id, capability.id]) {
    assert.ok(payload.failedTargetIds.includes(target), `failure propagation missing target ${target}`);
  }
} finally {
  fs.rmSync(stateRoot, { recursive: true, force: true });
}

const graphSource = fs.readFileSync(new URL("../intelligence/code-graph.mjs", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("./serve-local-viewer.mjs", import.meta.url), "utf8");
const flutterData = fs.readFileSync(new URL("../viewer_flutter/lib/model/graph_data.dart", import.meta.url), "utf8");
const flutterLive = fs.readFileSync(new URL("../viewer_flutter/lib/live/workspace_live.dart", import.meta.url), "utf8");
const flutterHost = fs.readFileSync(new URL("../viewer_flutter/lib/widgets/workspace_graph_host.dart", import.meta.url), "utf8");
const flutterScene = fs.readFileSync(new URL("../viewer_flutter/lib/model/graph_scene.dart", import.meta.url), "utf8");
const flutterView = fs.readFileSync(new URL("../viewer_flutter/lib/widgets/graph_view.dart", import.meta.url), "utf8");
const legacyLive = fs.readFileSync(new URL("../viewer/local-live.js", import.meta.url), "utf8");
const legacyRenderer = fs.readFileSync(new URL("../viewer/graph-v2-cluster-v2.js", import.meta.url), "utf8");
const legacyHtml = fs.readFileSync(new URL("../graph-v2.html", import.meta.url), "utf8");
const activityCli = fs.readFileSync(new URL("./totem-activity.mjs", import.meta.url), "utf8");

assert.ok(graphSource.includes("schemaVersion: 5"), "graph schema must advance for Verification Graph");
assert.ok(graphSource.includes("buildVerificationGraph"), "graph payload must derive verification data");
assert.ok(graphSource.includes("verification,"), "graph payload must publish verification");

for (const fragment of [
  'pathname === "/api/verification-state"',
  "recordVerificationEvent(ROOT, event)",
  "verificationStatePayload",
]) {
  assert.ok(serverSource.includes(fragment), `Bridge verification API missing: ${fragment}`);
}

for (const fragment of [
  "class GraphVerification",
  "class GraphTest",
  "class GraphVerificationRelation",
  "List<GraphTest> testsForFeature",
]) {
  assert.ok(flutterData.includes(fragment), `Flutter verification model missing: ${fragment}`);
}
for (const fragment of [
  "class VerificationState",
  "Future<VerificationState> verificationState()",
  "failedTargetIds",
]) {
  assert.ok(flutterLive.includes(fragment), `Flutter live verification client missing: ${fragment}`);
}
for (const fragment of [
  "_VerificationStrip(state: displayedVerification)",
  "runningVerificationTargetIds",
  "failedVerificationTargetIds",
]) {
  assert.ok(flutterHost.includes(fragment), `Flutter verification host missing: ${fragment}`);
}
for (const fragment of [
  "kind == 'test'",
  "data.testsForFeature(featureId)",
  "type: 'validated-by'",
]) {
  assert.ok(flutterScene.includes(fragment), `Flutter Test LOD missing: ${fragment}`);
}
for (const fragment of [
  "failedVerificationTargetIds",
  "verificationStatus",
  "'test' => const Color",
  "'validated-by' => const Color",
]) {
  assert.ok(flutterView.includes(fragment), `Flutter verification renderer missing: ${fragment}`);
}

for (const fragment of [
  'document.getElementById("verificationState")',
  'fetch(apiUrl("/api/verification-state")',
  "window.__TOTEM_VERIFICATION_STATE__",
  "verificationPolling",
]) {
  assert.ok(legacyLive.includes(fragment), `legacy verification live adapter missing: ${fragment}`);
}
for (const fragment of [
  "var verification = DATA.verification",
  "var testMap = new Map",
  '"validated-by"',
  'node.type === "test"',
  "failedVerificationTargets",
  "drawVerificationHalo",
  "changeIntelligence.affectedEntityIds",
]) {
  assert.ok(legacyRenderer.includes(fragment), `legacy verification renderer missing: ${fragment}`);
}
assert.ok(legacyHtml.includes('data-edge-filter="validated-by"'), "legacy validated-by filter is required");
assert.ok(legacyHtml.includes('id="verificationState"'), "legacy VERIFY status badge is required");
assert.ok(activityCli.includes('request("/api/verification-state")'), "activity CLI status must expose verification state");
assert.ok(activityCli.includes("--test <stable-test-id-or-repo-relative-path>"), "activity CLI must document safe Test target format");

console.log(
  "Phase 4 Verification Graph validation passed: stable Test entities, feature/API validated-by relations, requirements/evidence separation, Git mapping, persistent live state, failure propagation, and Flutter/legacy parity are present."
);
