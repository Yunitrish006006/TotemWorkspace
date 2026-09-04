#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildGraphViewModel } from "../intelligence/code-graph.mjs";

const graph = buildGraphViewModel();
const featureByTitle = (ownerId, pattern) => graph.features.find((feature) =>
  feature.ownerId === ownerId && pattern.test(`${feature.title} ${feature.summary}`));

const coreOutline = featureByTitle("totem-core", /世界輪廓|world\s*outline|outline/i);
const automataArea = featureByTitle("totem-automata", /採集區框線|gathering.*outline|area.*outline/i);
const automataLinks = featureByTitle("totem-automata", /容器連線|container.*line|container.*link/i);
const excavationOutline = featureByTitle("totem-excavation", /選區輪廓|selection.*outline/i);

assert.ok(coreOutline, "Core world-outline feature must exist");
assert.ok(automataArea, "Automata gathering-area outline feature must exist");
assert.ok(automataLinks, "Automata container-link feature must exist");
assert.ok(excavationOutline, "Excavation selection-outline feature must exist");

const outlineCaps = graph.sharedCapabilities.filter((capability) => capability.family === "core-api:client.world");
const byConsumerFeature = new Map(outlineCaps.map((capability) => [capability.consumerFeatureId, capability]));

for (const feature of [automataArea, automataLinks, excavationOutline]) {
  const capability = byConsumerFeature.get(feature.id);
  assert.ok(capability, `missing Core world-outline relation for ${feature.ownerId} / ${feature.title}`);
  assert.equal(capability.providerFeatureId, coreOutline.id);
  assert.ok(capability.evidencePaths.length > 0);
  assert.ok(capability.imports.some((name) => name.includes(".api.v1.client.world.")));
}

const consumerModules = new Set(outlineCaps.map((capability) => capability.consumerModuleId));
assert.ok(consumerModules.has("totem-automata"));
assert.ok(consumerModules.has("totem-excavation"));

console.log(`Live Core API capability validation passed: ${outlineCaps.length} client.world relations across ${consumerModules.size} consumer modules.`);
