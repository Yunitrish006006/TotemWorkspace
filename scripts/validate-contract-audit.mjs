#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditSource = fs.readFileSync(path.join(root, "viewer", "graph-v2-contract-audit.js"), "utf8");
const html = fs.readFileSync(path.join(root, "graph-v2.html"), "utf8");
const auditDoc = fs.readFileSync(path.join(root, "docs", "relationship-audit-2026-09-03.md"), "utf8");

const contractIds = [
  ...[
    "totem-alchemy", "totem-enchanting", "totem-discord-bridge", "totem-automata", "totem-vanilla-tweaks",
    "totem-excavation", "totem-villagers", "totem-locksmith", "totem-nexus", "totem-remnant"
  ].map((id) => `hard:${id}:totem-core`),
  "automata-excavation", "villagers-remnant", "remnant-trinkets",
  "automata-remnant", "automata-locksmith", "remnant-nexus",
  "vanilla-automata-observer", "vanilla-nexus-observer", "vanilla-locksmith-observer", "vanilla-villagers-observer", "vanilla-remnant-observer",
  "discord-worker", "automata-openai",
  "event-remnant-death", "event-nexus-audit", "event-locksmith-break",
  "observer:automata@1", "observer:locksmith@1", "observer:nexus@2", "observer:nexus-death@1", "observer:remnant@1", "observer:villagers@1"
];
assert.equal(contractIds.length, 32);

const data = { contracts: contractIds.map((id) => ({ id, featureIds: [] })) };
const context = vm.createContext({ window: { __TOTEM_GRAPH_DATA__: data }, Object });
new vm.Script(auditSource, { filename: "graph-v2-contract-audit.js" }).runInContext(context);
const contracts = context.window.__TOTEM_GRAPH_DATA__.contracts;
assert.equal(contracts.length, 32);
const byId = new Map(contracts.map((contract) => [contract.id, contract]));

assert.deepEqual(Array.from(byId.get("automata-excavation").featureIds), [
  "totem-automata.feature-3", "totem-excavation.feature-1", "totem-excavation.feature-2"
]);
assert.ok(!byId.get("automata-excavation").featureIds.includes("totem-excavation.feature-5"));
assert.deepEqual(Array.from(byId.get("villagers-remnant").featureIds), [
  "totem-villagers.feature-1", "totem-villagers.feature-2", "totem-remnant.feature-1"
]);
assert.deepEqual(Array.from(byId.get("automata-openai").featureIds), [
  "totem-automata.feature-1", "totem-automata.feature-3", "totem-automata.feature-6"
]);
assert.deepEqual(Array.from(byId.get("event-nexus-audit").featureIds), [
  "totem-nexus.feature-1", "totem-nexus.feature-6", "totem-discord-bridge.feature-1"
]);
assert.deepEqual(Array.from(byId.get("remnant-trinkets").featureIds), []);
assert.equal(byId.get("remnant-trinkets").implementationStatus, "metadata-only");
assert.equal(byId.get("event-remnant-death").implementationStatus, "contract-defined");
assert.ok(byId.has("observer:nexus@3"));
assert.ok(!byId.has("observer:nexus@2"));
assert.equal(byId.get("observer:nexus@3").protocol, 3);
assert.deepEqual(Array.from(byId.get("vanilla-nexus-observer").featureIds), [
  "totem-vanilla-tweaks.feature-1", "totem-nexus.feature-1", "totem-nexus.feature-2", "totem-nexus.feature-4", "totem-nexus.feature-5"
]);
assert.ok(!byId.get("vanilla-nexus-observer").featureIds.includes("totem-nexus.feature-6"));

for (const id of contractIds.filter((id) => id.startsWith("hard:"))) {
  assert.deepEqual(Array.from(byId.get(id).featureIds), []);
}

assert.ok(html.includes('src="viewer/graph-v2-contract-audit.js"'));
assert.ok(html.indexOf("viewer/generated/graph-data.js") < html.indexOf("viewer/graph-v2-contract-audit.js"));
assert.ok(html.indexOf("viewer/graph-v2-contract-audit.js") < html.indexOf("viewer/graph-v2.js"));
assert.ok(auditDoc.includes("32/32 contracts reviewed"));
assert.doesNotThrow(() => new Function(auditSource));

console.log("V2 contract audit validation passed: 32 contracts accounted for; audited feature endpoints and Nexus Observer v3 correction verified.");
