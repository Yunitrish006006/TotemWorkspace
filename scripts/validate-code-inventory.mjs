#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildCodeInventory, isProductionCode } from "../intelligence/code-inventory.mjs";

const knowledge = {
  snapshot: { date: "2026-09-04" },
  modules: [
    { id: "totem-a", name: "TotemA", repoName: "TotemA" },
    { id: "totem-b", name: "TotemB", repoName: "TotemB" }
  ]
};

const index = {
  generatedAt: "2026-09-04T00:00:00Z",
  chunks: [
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/api/AService.java",
      startLine: 1,
      symbols: ["AService", "send"],
      text: `package dev.example.totema.api;
import dev.example.totemb.api.BApi;
public interface AService {
  void send(Object payload);
}
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/network/ASyncPacket.java",
      startLine: 1,
      symbols: ["ASyncPacket", "register"],
      text: `package dev.example.totema.network;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
public final class ASyncPacket {
  void register() {
    ServerPlayNetworking.registerGlobalReceiver(null, null);
  }
}
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/runtime/RuntimeHooks.java",
      startLine: 1,
      symbols: ["RuntimeHooks", "register"],
      text: `package dev.example.totema.runtime;
import com.google.gson.Gson;
import com.mojang.brigadier.CommandDispatcher;
public final class RuntimeHooks {
  void register() {
    CommandRegistrationCallback.EVENT.register((dispatcher, access, environment) -> {});
    Registry.register(Registries.ITEM, null, null);
    ServerTickEvents.END_SERVER_TICK.register(server -> {});
  }
}
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/integration/JadeCompat.java",
      startLine: 1,
      symbols: ["JadeCompat"],
      text: `package dev.example.totema.integration;
public final class JadeCompat {
  boolean enabled() {
    return FabricLoader.getInstance().isModLoaded("jade");
  }
}
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/client/java/dev/example/totema/client/ConfigScreen.java",
      startLine: 1,
      symbols: ["ConfigScreen"],
      text: `package dev.example.totema.client;
public final class ConfigScreen extends Screen { }
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/test/java/dev/example/totema/FakeFeatureTest.java",
      startLine: 1,
      symbols: ["FakeFeatureTest"],
      text: "public final class FakeFeatureTest { OpenAI Discord Jade Trinkets }"
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "README.md",
      startLine: 1,
      symbols: [],
      text: "Feature: imaginary README-only teleport API"
    }
  ]
};

assert.equal(isProductionCode("src/main/java/a/A.java"), true);
assert.equal(isProductionCode("src/client/java/a/A.kt"), true);
assert.equal(isProductionCode("src/test/java/a/A.java"), false);
assert.equal(isProductionCode("README.md"), false);

const inventory = buildCodeInventory({ knowledge, index });
assert.equal(inventory.sourceScope, "production-code-only");
assert.equal(inventory.modules.length, 2);

const moduleA = inventory.modules.find((entry) => entry.moduleId === "totem-a");
assert.ok(moduleA);
assert.equal(moduleA.productionFileCount, 5);
assert.ok(moduleA.surfaces.api.some((entry) => entry.label === "AService"));
assert.ok(moduleA.surfaces.networking.some((entry) => entry.label === "ASyncPacket"));
assert.ok(moduleA.surfaces.commands.some((entry) => entry.label === "RuntimeHooks"));
assert.ok(moduleA.surfaces.registries.some((entry) => entry.label === "RuntimeHooks"));
assert.ok(moduleA.surfaces.events.some((entry) => entry.label === "RuntimeHooks"));
assert.ok(moduleA.surfaces.clientUi.some((entry) => entry.label === "ConfigScreen"));
assert.ok(moduleA.surfaces.integrations.some((entry) => entry.label === "JadeCompat"));
assert.ok(!moduleA.surfaces.integrations.some((entry) => entry.label === "RuntimeHooks"));
assert.ok(moduleA.integrations.some((entry) => entry.packageRoot === "com.google.gson"));
assert.ok(moduleA.crossModuleImports.some((entry) => entry.targetModuleId === "totem-b"));
assert.equal(JSON.stringify(moduleA).includes("FakeFeatureTest"), false);
assert.equal(JSON.stringify(moduleA).includes("imaginary README-only"), false);

const moduleB = inventory.modules.find((entry) => entry.moduleId === "totem-b");
assert.ok(moduleB);
assert.equal(moduleB.productionFileCount, 0);

console.log("Code-first inventory validation passed.");
