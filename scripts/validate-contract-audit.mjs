#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKnowledge } from "../intelligence/workspace-knowledge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audit = JSON.parse(fs.readFileSync(path.join(root, "data", "relationship-audit.json"), "utf8"));
const auditDoc = fs.readFileSync(path.join(root, "docs", "relationship-audit-2026-09-03.md"), "utf8");
const html = fs.readFileSync(path.join(root, "graph-v2.html"), "utf8");
const knowledge = loadKnowledge(root);
const byId = knowledge.contractById;

assert.equal(audit.schemaVersion, 1);
assert.equal(audit.auditedAt, "2026-09-03");
assert.equal(audit.contractCount, 32);
assert.equal(knowledge.contracts.length, 32);
assert.equal(knowledge.features.length, 58);

const hardIds = [
  "totem-alchemy", "totem-enchanting", "totem-discord-bridge", "totem-automata", "totem-vanilla-tweaks",
  "totem-excavation", "totem-villagers", "totem-locksmith", "totem-nexus", "totem-remnant"
].map((id) => `hard:${id}:totem-core`);
const hardFeatureEndpoints = new Map([
  ["hard:totem-locksmith:totem-core", ["totem-locksmith.feature-2", "totem-core.feature-3"]],
  ["hard:totem-nexus:totem-core", ["totem-nexus.feature-5", "totem-core.feature-3"]]
]);
for (const id of hardIds) {
  assert.ok(byId.has(id), `missing hard dependency ${id}`);
  assert.deepEqual(Array.from(byId.get(id).featureIds), hardFeatureEndpoints.get(id) ?? []);
}
assert.equal(byId.get("hard:totem-locksmith:totem-core").auditStatus, "verified");
assert.equal(byId.get("hard:totem-nexus:totem-core").auditStatus, "verified");

assert.deepEqual(Array.from(byId.get("automata-excavation").featureIds), [
  "totem-automata.feature-3", "totem-excavation.feature-1", "totem-excavation.feature-2"
]);
assert.ok(!byId.get("automata-excavation").featureIds.includes("totem-excavation.feature-5"));
assert.deepEqual(Array.from(byId.get("villagers-remnant").featureIds), [
  "totem-villagers.feature-1", "totem-villagers.feature-2", "totem-remnant.feature-1"
]);
assert.deepEqual(Array.from(byId.get("automata-remnant").featureIds), [
  "totem-automata.feature-1", "totem-remnant.feature-1", "totem-remnant.feature-5"
]);
assert.deepEqual(Array.from(byId.get("automata-locksmith").featureIds), [
  "totem-automata.feature-1", "totem-automata.feature-2", "totem-automata.feature-3",
  "totem-locksmith.feature-1", "totem-locksmith.feature-2", "totem-locksmith.feature-3"
]);
assert.deepEqual(Array.from(byId.get("remnant-nexus").featureIds), [
  "totem-remnant.feature-4", "totem-nexus.feature-6"
]);
assert.deepEqual(Array.from(byId.get("automata-openai").featureIds), [
  "totem-automata.feature-1", "totem-automata.feature-3", "totem-automata.feature-6"
]);
assert.equal(byId.get("automata-openai").to, "external:openai");
assert.deepEqual(Array.from(byId.get("event-nexus-audit").featureIds), [
  "totem-nexus.feature-1", "totem-nexus.feature-6", "totem-discord-bridge.feature-1"
]);
assert.deepEqual(Array.from(byId.get("event-locksmith-break").featureIds), [
  "totem-locksmith.feature-4", "totem-discord-bridge.feature-1"
]);

assert.deepEqual(Array.from(byId.get("remnant-trinkets").featureIds), []);
assert.equal(byId.get("remnant-trinkets").implementationStatus, "metadata-only");
assert.equal(byId.get("event-remnant-death").implementationStatus, "contract-defined");
assert.deepEqual(Array.from(byId.get("event-remnant-death").featureIds), [
  "totem-remnant.feature-4", "totem-discord-bridge.feature-1"
]);

assert.deepEqual(Array.from(byId.get("vanilla-nexus-observer").featureIds), [
  "totem-vanilla-tweaks.feature-1", "totem-nexus.feature-1", "totem-nexus.feature-2",
  "totem-nexus.feature-4", "totem-nexus.feature-5"
]);
assert.equal(byId.get("vanilla-nexus-observer").protocol, 3);
assert.ok(!byId.get("vanilla-nexus-observer").featureIds.includes("totem-nexus.feature-6"));

const nexusProviderId = "observer:totem-nexus:nexus@3";
const oldNexusProviderId = "observer:totem-nexus:nexus@2";
assert.ok(byId.has(nexusProviderId));
assert.ok(!byId.has(oldNexusProviderId));
assert.equal(byId.get(nexusProviderId).protocol, 3);
assert.deepEqual(Array.from(byId.get(nexusProviderId).variants), [
  "compass", "map", "management", "map_legacy", "friends", "friends_legacy", "registration", "registration_legacy"
]);
assert.ok(byId.has("observer:totem-nexus:nexus_death_node_admin@1"));

const feature = (id) => knowledge.featureById.get(id);
assert.equal(feature("totem-core.feature-3").title, "Friendship");
assert.equal(feature("totem-nexus.feature-5").title, "好友與玩家目標");
assert.equal(feature("totem-locksmith.feature-2").title, "存取控制");
assert.ok(feature("totem-automata.feature-3").softContractIds.includes("automata-excavation"));
assert.ok(feature("totem-excavation.feature-1").softContractIds.includes("automata-excavation"));
assert.ok(feature("totem-excavation.feature-2").softContractIds.includes("automata-excavation"));
assert.ok(!feature("totem-excavation.feature-5").softContractIds.includes("automata-excavation"));
assert.ok(feature("totem-villagers.feature-1").softContractIds.includes("villagers-remnant"));
assert.ok(feature("totem-villagers.feature-2").softContractIds.includes("villagers-remnant"));
assert.ok(feature("totem-automata.feature-3").serviceContractIds.includes("automata-openai"));
assert.ok(feature("totem-nexus.feature-1").eventContractIds.includes("event-nexus-audit"));
assert.ok(feature("totem-nexus.feature-6").eventContractIds.includes("event-nexus-audit"));
assert.ok(!knowledge.features.some((entry) => entry.softContractIds.includes("remnant-trinkets")));

const grouped = knowledge.contracts.reduce((out, contract) => {
  (out[contract.type] ??= []).push(contract);
  return out;
}, {});
assert.deepEqual([
  grouped["hard-core"]?.length,
  grouped["fabric-suggests"]?.length,
  grouped["runtime-optional"]?.length,
  grouped["external-service"]?.length,
  grouped.eventbus?.length,
  grouped["observer-provider"]?.length
], [10, 3, 8, 2, 3, 6]);

assert.ok(html.includes('src="viewer/generated/graph-data.js"'));
assert.ok(html.includes('src="viewer/graph-v2-adapter.js"'));
assert.ok(html.includes('src="viewer/graph-v2-cluster-v2.js"'));
assert.ok(!html.includes('src="viewer/graph-v2.js"'));
assert.ok(!html.includes('id="mode2d"') && !html.includes('id="pane2d"'));
assert.ok(!html.includes("graph-v2-contract-audit.js"));
assert.ok(auditDoc.includes("32/32 contracts reviewed"));

console.log("Canonical relationship validation passed: 32 contracts, audited feature endpoints including Core Friendship consumers, metadata-only qualifications, and Nexus Observer v3 are loaded directly by workspace intelligence.");
