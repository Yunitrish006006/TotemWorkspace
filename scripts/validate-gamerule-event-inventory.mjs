#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildCodeInventory } from "../intelligence/code-inventory.mjs";

const knowledge = {
  snapshot: { date: "2026-09-04" },
  modules: [{ id: "totem-eventdemo", name: "TotemEventDemo", repoName: "TotemEventDemo" }]
};

const index = {
  generatedAt: "2026-09-04T00:00:00Z",
  chunks: [{
    moduleId: "totem-eventdemo",
    repoName: "TotemEventDemo",
    path: "src/main/java/dev/example/eventdemo/rules/ExpansionRules.java",
    startLine: 1,
    symbols: ["ExpansionRules", "register"],
    text: `package dev.example.eventdemo.rules;
public final class ExpansionRules {
  public static void register() {
    GameRuleEvents.changeCallback(EXPANSION_MODE).register((mode, server) -> refresh(server));
  }
  static void refresh(Object server) { }
}
`
  }]
};

const inventory = buildCodeInventory({ knowledge, index });
const module = inventory.modules[0];
assert.equal(module.productionFileCount, 1);
assert.ok(module.surfaces.events.some((entry) => entry.label === "ExpansionRules"));
console.log("GameRule event inventory validation passed.");
