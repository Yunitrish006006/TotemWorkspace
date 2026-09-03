#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildCodeInventory, isProductionCode } from "../intelligence/code-inventory.mjs";

const knowledge = {
  snapshot: { date: "2026-09-04" },
  modules: [
    { id: "totem-a", name: "TotemA", repoName: "TotemA" },
    { id: "totem-b", name: "TotemB", repoName: "TotemB" },
    { id: "totem-core", name: "TotemCore", repoName: "TotemCore" },
    { id: "totem-alchemy", name: "TotemAlchemy", repoName: "TotemAlchemy" }
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
import dev.totem.core.api.CoreApi;
import dev.totem.alchemy.AlchemyApi;
import dev.example.totema.adapter.TotemBAdapter;
import net.minecraft.core.BlockPos;
import net.minecraft.world.item.alchemy.PotionContents;
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
      path: "src/main/java/dev/example/totema/runtime/ConnectionSync.java",
      startLine: 1,
      symbols: ["ConnectionSync", "register"],
      text: `package dev.example.totema.runtime;
public final class ConnectionSync {
  void register() { ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {}); }
}
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/runtime/MixtureState.java",
      startLine: 1,
      symbols: ["MixtureState", "encode", "decode"],
      text: `package dev.example.totema.runtime;
public final class MixtureState {
  public String encode() { return "state"; }
  public static MixtureState decode(String encoded) { return new MixtureState(); }
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
      path: "src/main/java/dev/example/totema/block/AlchemyBlockEntity.java",
      startLine: 1,
      symbols: ["AlchemyBlockEntity", "saveAdditional", "loadAdditional"],
      text: `package dev.example.totema.block;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
public final class AlchemyBlockEntity {
  protected void saveAdditional(ValueOutput output) { output.putInt("Value", 1); }
  protected void loadAdditional(ValueInput input) { input.getIntOr("Value", 0); }
}
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/item/CustomDataStore.java",
      startLine: 1,
      symbols: ["CustomDataStore", "read"],
      text: `package dev.example.totema.item;
public final class CustomDataStore {
  Object read(ItemStack stack) { return stack.getOrDefault(DataComponents.CUSTOM_DATA, CustomData.EMPTY); }
}
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/observer/ObserverSessionManager.java",
      startLine: 1,
      symbols: ["ObserverSessionManager"],
      text: `package dev.example.totema.observer;
public final class ObserverSessionManager { }
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/inventory/ContainerSortService.java",
      startLine: 1,
      symbols: ["ContainerSortService"],
      text: `package dev.example.totema.inventory;
public final class ContainerSortService { }
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
      path: "src/client/java/dev/example/totema/client/EffectTooltip.java",
      startLine: 1,
      symbols: ["EffectTooltip", "register"],
      text: `package dev.example.totema.client;
public final class EffectTooltip { void register() { ItemTooltipCallback.EVENT.register((stack, context, type, lines) -> {}); } }
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/client/java/dev/example/totema/client/MixtureColorProvider.java",
      startLine: 1,
      symbols: ["MixtureColorProvider", "register"],
      text: `package dev.example.totema.client;
public final class MixtureColorProvider { void register() { BlockColorRegistry.register(null, null); } }
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/client/java/dev/example/totema/client/ItemActivationFeedback.java",
      startLine: 1,
      symbols: ["ItemActivationFeedback", "show"],
      text: `package dev.example.totema.client;
public final class ItemActivationFeedback {
  void show(Client context, ItemStack stack) { context.gameRenderer.displayItemActivation(stack); }
}
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/client/java/dev/example/totema/client/ObserverBeaconScreenClient.java",
      startLine: 1,
      symbols: ["ObserverBeaconScreenClient", "show", "ObserverBeaconScreen"],
      text: `package dev.example.totema.client;
public final class ObserverBeaconScreenClient {
  Object transientBanner(ItemStack stack) { return stack.getOrDefault(DataComponents.BANNER_PATTERNS, BannerPatternLayers.EMPTY); }
  void show(Minecraft client) { client.setScreenAndShow(new ObserverBeaconScreen()); }
  static final class ObserverBeaconScreen extends BeaconScreen { }
}
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/client/java/dev/example/totema/client/ObserverUiClient.java",
      startLine: 1,
      symbols: ["ObserverUiClient"],
      text: `package dev.example.totema.client;
public final class ObserverUiClient { }
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/client/java/dev/example/totema/client/ContainerSortClient.java",
      startLine: 1,
      symbols: ["ContainerSortClient"],
      text: `package dev.example.totema.client;
public final class ContainerSortClient { }
`
    },
    {
      moduleId: "totem-b",
      repoName: "TotemB",
      path: "src/main/java/dev/example/totemb/api/BApi.java",
      startLine: 1,
      symbols: ["BApi"],
      text: `package dev.example.totemb.api;
public interface BApi { }
`
    },
    {
      moduleId: "totem-core",
      repoName: "TotemCore",
      path: "src/main/java/dev/totem/core/api/CoreApi.java",
      startLine: 1,
      symbols: ["CoreApi"],
      text: `package dev.totem.core.api;
public interface CoreApi { }
`
    },
    {
      moduleId: "totem-alchemy",
      repoName: "TotemAlchemy",
      path: "src/main/java/dev/totem/alchemy/AlchemyApi.java",
      startLine: 1,
      symbols: ["AlchemyApi"],
      text: `package dev.totem.alchemy;
public interface AlchemyApi { }
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
assert.equal(inventory.modules.length, 4);

const moduleA = inventory.modules.find((entry) => entry.moduleId === "totem-a");
assert.ok(moduleA);
assert.equal(moduleA.productionFileCount, 17);
assert.ok(moduleA.surfaces.api.some((entry) => entry.label === "AService"));
assert.ok(moduleA.surfaces.networking.some((entry) => entry.label === "ASyncPacket"));
assert.ok(moduleA.surfaces.commands.some((entry) => entry.label === "RuntimeHooks"));
assert.ok(moduleA.surfaces.registries.some((entry) => entry.label === "RuntimeHooks"));
assert.ok(moduleA.surfaces.events.some((entry) => entry.label === "RuntimeHooks"));
assert.ok(moduleA.surfaces.events.some((entry) => entry.label === "ConnectionSync"));
assert.ok(moduleA.surfaces.persistence.some((entry) => entry.label === "MixtureState"));
assert.ok(moduleA.surfaces.persistence.some((entry) => entry.label === "AlchemyBlockEntity"));
assert.ok(moduleA.surfaces.persistence.some((entry) => entry.label === "CustomDataStore"));
assert.ok(!moduleA.surfaces.persistence.some((entry) => entry.label === "ObserverBeaconScreenClient"));
assert.ok(moduleA.surfaces.clientUi.some((entry) => entry.label === "ConfigScreen"));
assert.ok(moduleA.surfaces.clientUi.some((entry) => entry.label === "EffectTooltip"));
assert.ok(moduleA.surfaces.clientUi.some((entry) => entry.label === "MixtureColorProvider"));
assert.ok(moduleA.surfaces.clientUi.some((entry) => entry.label === "ItemActivationFeedback"));
assert.ok(moduleA.surfaces.clientUi.some((entry) => entry.label === "ObserverBeaconScreenClient"));
assert.ok(moduleA.surfaces.clientUi.some((entry) => entry.label === "ObserverUiClient"));
assert.ok(moduleA.surfaces.integrations.some((entry) => entry.label === "JadeCompat"));
assert.ok(!moduleA.surfaces.integrations.some((entry) => entry.label === "RuntimeHooks"));
assert.ok(moduleA.integrations.some((entry) => entry.packageRoot === "com.google.gson"));

const observerArea = moduleA.featureAreas.find((entry) => entry.key === "observer");
const inventoryArea = moduleA.featureAreas.find((entry) => entry.key === "inventory");
assert.ok(observerArea);
assert.ok(inventoryArea);
assert.equal(observerArea.fileCount, 3);
assert.ok(observerArea.representativePaths.some((path) => path.endsWith("ObserverBeaconScreenClient.java")));
assert.ok(observerArea.representativePaths.some((path) => path.endsWith("ObserverUiClient.java")));
assert.equal(inventoryArea.fileCount, 2);
assert.ok(inventoryArea.representativePaths.some((path) => path.endsWith("ContainerSortClient.java")));

const crossB = moduleA.crossModuleImports.find((entry) => entry.targetModuleId === "totem-b");
const crossCore = moduleA.crossModuleImports.find((entry) => entry.targetModuleId === "totem-core");
const crossAlchemy = moduleA.crossModuleImports.find((entry) => entry.targetModuleId === "totem-alchemy");
assert.ok(crossB);
assert.ok(crossCore);
assert.ok(crossAlchemy);
assert.deepEqual(crossB.imports, ["dev.example.totemb.api.BApi"]);
assert.deepEqual(crossCore.imports, ["dev.totem.core.api.CoreApi"]);
assert.deepEqual(crossAlchemy.imports, ["dev.totem.alchemy.AlchemyApi"]);
assert.equal(JSON.stringify(moduleA.crossModuleImports).includes("net.minecraft.core"), false);
assert.equal(JSON.stringify(moduleA.crossModuleImports).includes("net.minecraft.world.item.alchemy"), false);
assert.equal(JSON.stringify(moduleA.crossModuleImports).includes("TotemBAdapter"), false);
assert.equal(JSON.stringify(moduleA).includes("FakeFeatureTest"), false);
assert.equal(JSON.stringify(moduleA).includes("imaginary README-only"), false);

const moduleB = inventory.modules.find((entry) => entry.moduleId === "totem-b");
const moduleCore = inventory.modules.find((entry) => entry.moduleId === "totem-core");
const moduleAlchemy = inventory.modules.find((entry) => entry.moduleId === "totem-alchemy");
assert.ok(moduleB);
assert.ok(moduleCore);
assert.ok(moduleAlchemy);
assert.equal(moduleB.productionFileCount, 1);
assert.equal(moduleCore.productionFileCount, 1);
assert.equal(moduleAlchemy.productionFileCount, 1);

console.log("Code-first inventory validation passed.");
