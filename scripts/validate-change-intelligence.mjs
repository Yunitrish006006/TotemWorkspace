#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildChangeIntelligence,
  collectGitChanges,
  diffSemanticSnapshots,
  loadChangeIntelligence,
  mapGitChangesToSemantic,
  saveChangeIntelligence,
  semanticSnapshot
} from "../intelligence/change-intelligence.mjs";
import { loadKnowledge } from "../intelligence/workspace-knowledge.mjs";

const beforeGraph = {
  generatedAt: "2026-09-05T00:00:00Z",
  modules: [
    { id: "totem-core", name: "TotemCore", version: "1", role: "core", featureGroups: [] },
    { id: "totem-alchemy", name: "TotemAlchemy", version: "1", role: "alchemy", featureGroups: [] }
  ],
  features: [
    { id: "totem-alchemy.feature-1", ownerId: "totem-alchemy", title: "Brewing", summary: "Brewing", softContractIds: [], serviceContractIds: [], eventContractIds: [] }
  ],
  components: [
    {
      id: "component:totem-alchemy:brewing",
      moduleId: "totem-alchemy",
      key: "brewing",
      label: "Brewing",
      responsibility: "old responsibility",
      featureIds: ["totem-alchemy.feature-1"],
      mappingConfidence: "high",
      implementationPaths: ["src/main/java/example/A.java"],
      surfaceKinds: ["source"]
    }
  ],
  code: {
    nodes: [
      { id: "code-file:totem-alchemy:src/main/java/example/A.java", type: "code-file", moduleId: "totem-alchemy", category: "source", path: "src/main/java/example/A.java", symbolCount: 1 }
    ]
  },
  contracts: [
    { id: "hard:totem-alchemy:totem-core", type: "hard-core", from: "totem-alchemy", to: "totem-core", featureIds: [] }
  ],
  sharedCapabilities: []
};

const afterGraph = {
  ...beforeGraph,
  generatedAt: "2026-09-05T00:01:00Z",
  components: [
    {
      ...beforeGraph.components[0],
      responsibility: "new responsibility",
      implementationPaths: ["src/main/java/example/A.java", "src/main/java/example/B.java"]
    }
  ],
  code: {
    nodes: [
      ...beforeGraph.code.nodes,
      { id: "code-file:totem-alchemy:src/main/java/example/B.java", type: "code-file", moduleId: "totem-alchemy", category: "source", path: "src/main/java/example/B.java", symbolCount: 2 }
    ]
  },
  contracts: [
    { id: "hard:totem-alchemy:totem-core", type: "runtime-optional", from: "totem-alchemy", to: "totem-core", featureIds: [] }
  ]
};

const before = semanticSnapshot(beforeGraph);
const after = semanticSnapshot(afterGraph);
assert.equal(before.schemaVersion, 1);
assert.ok(before.entities.some((entry) => entry.id === "component:totem-alchemy:brewing"));
assert.ok(before.entities.some((entry) => entry.type === "implementation"));

const semanticDiff = diffSemanticSnapshots(before, after);
assert.ok(semanticDiff.modified.some((entry) => entry.id === "component:totem-alchemy:brewing"));
assert.ok(semanticDiff.added.some((entry) => entry.id.endsWith("/B.java")));
const relationChange = semanticDiff.modified.find((entry) => entry.id === "hard:totem-alchemy:totem-core");
assert.ok(relationChange, "relation mutation must be part of semantic diff");
assert.deepEqual(relationChange.moduleIds.sort(), ["totem-alchemy", "totem-core"]);

const gitChanges = [{
  moduleId: "totem-alchemy",
  repoName: "TotemAlchemy",
  status: "A",
  path: "src/main/java/example/B.java",
  previousPath: null
}];

const mapped = mapGitChangesToSemantic(gitChanges, { beforeGraph, afterGraph });
assert.equal(mapped.length, 1);
assert.deepEqual(mapped[0].componentIds, ["component:totem-alchemy:brewing"]);
assert.deepEqual(mapped[0].featureIds, ["totem-alchemy.feature-1"]);
assert.deepEqual(mapped[0].implementationIds, ["implementation:component:totem-alchemy:brewing:src/main/java/example/B.java"]);

const intelligence = buildChangeIntelligence({
  knowledge: loadKnowledge(),
  beforeGraph,
  afterGraph,
  gitChanges
});
assert.ok(intelligence.semanticDiff.changedEntityIds.length >= 3);
assert.ok(intelligence.impact.touchedModules.includes("totem-alchemy"));
assert.ok(intelligence.impact.impactedModules.includes("totem-core"));

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "totem-change-state-"));
try {
  saveChangeIntelligence(stateRoot, intelligence);
  assert.deepEqual(loadChangeIntelligence(stateRoot), JSON.parse(JSON.stringify(intelligence)));
} finally {
  fs.rmSync(stateRoot, { recursive: true, force: true });
}

const reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), "totem-change-git-"));
try {
  const repoPath = path.join(reposRoot, "ExampleRepo");
  fs.mkdirSync(repoPath);
  execFileSync("git", ["init", "-q"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "ci@example.invalid"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "CI"], { cwd: repoPath });
  fs.writeFileSync(path.join(repoPath, "A.txt"), "before\n", "utf8");
  execFileSync("git", ["add", "A.txt"], { cwd: repoPath });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: repoPath });
  fs.writeFileSync(path.join(repoPath, "A.txt"), "after\n", "utf8");
  fs.writeFileSync(path.join(repoPath, "B.txt"), "new\n", "utf8");

  const changes = collectGitChanges({
    knowledge: { modules: [{ id: "totem-example", repoName: "ExampleRepo" }] },
    reposRoot
  });
  assert.deepEqual(
    changes.map((entry) => [entry.status, entry.path]),
    [["M", "A.txt"], ["A", "B.txt"]]
  );
} finally {
  fs.rmSync(reposRoot, { recursive: true, force: true });
}

const serverSource = fs.readFileSync(new URL("./serve-local-viewer.mjs", import.meta.url), "utf8");
assert.ok(serverSource.includes('pathname === "/api/change-intelligence"'), "Phase 3 API endpoint is required");
assert.ok(serverSource.includes("const beforeGraph = buildGraphViewModel"), "refresh must capture the before semantic graph");
assert.ok(serverSource.includes("const afterGraph = buildGraphViewModel"), "refresh must capture the after semantic graph");
assert.ok(serverSource.includes("saveChangeIntelligence"), "refresh must persist the latest change intelligence result");
assert.ok(serverSource.includes('type: "git_diff_updated"'), "semantic refresh must emit git_diff_updated activity");

console.log("Phase 3 change-intelligence validation passed: before/after snapshots, Git mapping, semantic diff, impact propagation, persistence, and API wiring are present.");
