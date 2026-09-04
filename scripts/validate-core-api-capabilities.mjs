#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildGraphViewModel } from "../intelligence/code-graph.mjs";

const modules = [
  { id: "totem-core", name: "TotemCore", repoName: "TotemCore", version: "0.7.16", role: "Core", featureGroups: [] },
  { id: "totem-automata", name: "TotemAutomata", repoName: "TotemAutomata", version: "0.1.22", role: "Automata", featureGroups: [] },
  { id: "totem-excavation", name: "TotemExcavation", repoName: "TotemExcavation", version: "0.1.10", role: "Excavation", featureGroups: [] }
];

const features = [
  {
    id: "totem-core.feature-5",
    ownerId: "totem-core",
    title: "世界輪廓 API",
    summary: "無狀態提交方塊、長方體與任意兩點實線。",
    softContractIds: [], serviceContractIds: [], eventContractIds: []
  },
  {
    id: "totem-automata.feature-4",
    ownerId: "totem-automata",
    title: "採集區框線",
    summary: "使用 Core 長方體輪廓顯示工作區。",
    softContractIds: [], serviceContractIds: [], eventContractIds: []
  },
  {
    id: "totem-automata.feature-5",
    ownerId: "totem-automata",
    title: "容器連線",
    summary: "來源與目的地使用 Core 實線顯示。",
    softContractIds: [], serviceContractIds: [], eventContractIds: []
  },
  {
    id: "totem-excavation.feature-3",
    ownerId: "totem-excavation",
    title: "選區輪廓",
    summary: "選區以 Core 世界輪廓 API 顯示。",
    softContractIds: [], serviceContractIds: [], eventContractIds: []
  }
];

const knowledge = {
  snapshot: { date: "2026-09-04" },
  modules,
  features,
  contracts: [],
  moduleById: new Map(modules.map((module) => [module.id, module]))
};

const chunks = [
  {
    moduleId: "totem-core",
    repoName: "TotemCore",
    path: "src/main/java/dev/totem/core/api/v1/client/world/TotemWorldOutlines.java",
    startLine: 1,
    symbols: ["TotemWorldOutlines"],
    text: `package dev.totem.core.api.v1.client.world;
public final class TotemWorldOutlines { }
`
  },
  {
    moduleId: "totem-automata",
    repoName: "TotemAutomata",
    path: "src/client/java/dev/totem/automata/client/CopperGolemVisualizationClient.java",
    startLine: 1,
    symbols: ["CopperGolemVisualizationClient"],
    text: `package dev.totem.automata.client;
import dev.totem.core.api.v1.client.world.TotemWorldOutlines;
import dev.totem.core.api.v1.client.world.WorldOutlineOcclusion;
import dev.totem.core.api.v1.client.world.WorldOutlineStyle;
public final class CopperGolemVisualizationClient {
  void render() { TotemWorldOutlines.cuboid(null, null); }
}
`
  },
  {
    moduleId: "totem-excavation",
    repoName: "TotemExcavation",
    path: "src/main/java/dev/totem/excavation/client/ExcavationOutlineRenderer.java",
    startLine: 1,
    symbols: ["ExcavationOutlineRenderer"],
    text: `package dev.totem.excavation.client;
import dev.totem.core.api.v1.client.world.TotemWorldOutlines;
import dev.totem.core.api.v1.client.world.WorldOutlineOcclusion;
import dev.totem.core.api.v1.client.world.WorldOutlineStyle;
public final class ExcavationOutlineRenderer {
  void render() { TotemWorldOutlines.cuboid(null, null); }
}
`
  }
];

const index = {
  generatedAt: "2026-09-04T00:00:00Z",
  fileStates: chunks.map((chunk) => ({
    moduleId: chunk.moduleId,
    repoName: chunk.repoName,
    path: chunk.path,
    mtimeMs: 0
  })),
  chunks
};

const graph = buildGraphViewModel({ knowledge, index });
const outlineLinks = graph.sharedCapabilities.filter((capability) => capability.family === "core-api:client.world");

assert.equal(outlineLinks.length, 3);
assert.deepEqual(
  outlineLinks.map((capability) => capability.consumerFeatureId).sort(),
  [
    "totem-automata.feature-4",
    "totem-automata.feature-5",
    "totem-excavation.feature-3"
  ]
);
assert.ok(outlineLinks.every((capability) => capability.providerFeatureId === "totem-core.feature-5"));
assert.ok(outlineLinks.every((capability) => capability.label === "Core World Outline API"));
assert.ok(outlineLinks.every((capability) => capability.imports.includes("dev.totem.core.api.v1.client.world.TotemWorldOutlines")));
assert.ok(outlineLinks.some((capability) => capability.consumerModuleId === "totem-automata"));
assert.ok(outlineLinks.some((capability) => capability.consumerModuleId === "totem-excavation"));

console.log("Core API shared capability validation passed.");
