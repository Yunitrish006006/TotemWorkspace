#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildCodeInventory, isProductionCode } from "../intelligence/code-inventory.mjs";

const knowledge = {
  snapshot: { date: "2026-09-04" },
  modules: [
    { id: "totem-a", name: "TotemA", repoName: "TotemA" },
    { id: "totem-b", name: "TotemB", repoName: "TotemB" },
    { id: "totem-core", name: "TotemCore", repoName: "TotemCore" },
    { id: "totem-alchemy", name: "TotemAlchemy", repoName: "TotemAlchemy" },
    { id: "totem-copperworks", name: "TotemCopperworks", repoName: "TotemCopperworks" },
    { id: "totem-observerdemo", name: "TotemObserverDemo", repoName: "TotemObserverDemo" },
    { id: "totem-bridgedemo", name: "TotemBridgeDemo", repoName: "TotemBridgeDemo" }
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
      path: "src/main/java/dev/example/totema/bookshelf/BookshelfInventoryRule.java",
      startLine: 1,
      symbols: ["BookshelfInventoryRule"],
      text: `package dev.example.totema.bookshelf;
public final class BookshelfInventoryRule { }
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/mixin/RecipeManagerMixin.java",
      startLine: 1,
      symbols: ["RecipeManagerMixin", "removeVanillaBookshelfRecipe"],
      text: `package dev.example.totema.mixin;
public final class RecipeManagerMixin { void removeVanillaBookshelfRecipe() {} }
`
    },
    {
      moduleId: "totem-a",
      repoName: "TotemA",
      path: "src/main/java/dev/example/totema/mixin/StructureTemplateMixin.java",
      startLine: 1,
      symbols: ["StructureTemplateMixin", "filledBookshelfState"],
      text: `package dev.example.totema.mixin;
public final class StructureTemplateMixin { void filledBookshelfState() {} }
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

const syntheticChunk = (path, packageName, className, symbols = [className]) => ({
  moduleId: "totem-copperworks",
  repoName: "TotemCopperworks",
  path,
  startLine: 1,
  symbols,
  text: `package ${packageName};
public final class ${className} { }
`
});

index.chunks.push(
  ...Array.from({ length: 10 }, (_, index) => syntheticChunk(
    `src/main/java/dev/example/copperworks/copper/GatheringWork${index}.java`,
    "dev.example.copperworks.copper",
    `GatheringWork${index}`
  )),
  ...Array.from({ length: 8 }, (_, index) => syntheticChunk(
    `src/main/java/dev/example/copperworks/copper/SortingWork${index}.java`,
    "dev.example.copperworks.copper",
    `SortingWork${index}`
  )),
  ...Array.from({ length: 5 }, (_, index) => syntheticChunk(
    `src/main/java/dev/example/copperworks/copper/CopperWrenchWork${index}.java`,
    "dev.example.copperworks.copper",
    `CopperWrenchWork${index}`
  )),
  ...Array.from({ length: 5 }, (_, index) => syntheticChunk(
    `src/main/java/dev/example/copperworks/copper/LlmWorker${index}.java`,
    "dev.example.copperworks.copper",
    `LlmWorker${index}`
  )),
  ...Array.from({ length: 3 }, (_, index) => syntheticChunk(
    `src/main/java/dev/example/copperworks/copper/CopperGolemCore${index}.java`,
    "dev.example.copperworks.copper",
    `CopperGolemCore${index}`
  )),
  syntheticChunk(
    "src/main/java/dev/example/copperworks/client/CopperGolemMenuPanelLayout.java",
    "dev.example.copperworks.client",
    "CopperGolemMenuPanelLayout"
  ),
  syntheticChunk(
    "src/main/java/dev/example/copperworks/client/CopperGolemMenuEditor.java",
    "dev.example.copperworks.client",
    "CopperGolemMenuEditor"
  ),
  syntheticChunk(
    "src/client/java/dev/example/copperworks/client/CopperGolemMenuUiState.java",
    "dev.example.copperworks.client",
    "CopperGolemMenuUiState"
  ),
  syntheticChunk(
    "src/client/java/dev/example/copperworks/client/CopperGolemMenuScreenSession.java",
    "dev.example.copperworks.client",
    "CopperGolemMenuScreenSession",
    [
      "CopperGolemMenuScreenSession",
      "CopperGolemData",
      "CopperGolemController",
      "CopperGolemActivity",
      "CopperGolemBinding",
      "CopperGolemMode",
      "CopperGolemFuelService"
    ]
  ),
  syntheticChunk(
    "src/client/java/dev/example/copperworks/client/CopperGolemClientPayloadRegistration.java",
    "dev.example.copperworks.client",
    "CopperGolemClientPayloadRegistration"
  ),
  syntheticChunk(
    "src/client/java/dev/example/copperworks/client/CopperGolemMenuPayloadBridge.java",
    "dev.example.copperworks.client",
    "CopperGolemMenuPayloadBridge"
  ),
  syntheticChunk(
    "src/main/java/dev/example/copperworks/menu/CopperGolemMenu.java",
    "dev.example.copperworks.menu",
    "CopperGolemMenu"
  ),
  {
    moduleId: "totem-copperworks",
    repoName: "TotemCopperworks",
    path: "src/main/java/dev/example/copperworks/TotemCopperworks.java",
    startLine: 1,
    symbols: ["TotemCopperworks", "onInitialize"],
    text: `package dev.example.copperworks;
public final class TotemCopperworks implements ModInitializer {
  public void onInitialize() { }
}
`
  }
);

const observerChunk = (className) => ({
  moduleId: "totem-observerdemo",
  repoName: "TotemObserverDemo",
  path: `src/main/java/dev/example/observerdemo/observer/${className}.java`,
  startLine: 1,
  symbols: [className],
  text: `package dev.example.observerdemo.observer;
public final class ${className} { }
`
});
index.chunks.push(
  ...Array.from({ length: 10 }, (_, index) => observerChunk(`ObserverRelay${index}`)),
  ...Array.from({ length: 10 }, (_, index) => observerChunk(`ObserverSession${index}`)),
  ...Array.from({ length: 10 }, (_, index) => observerChunk(`ObserverPriority${index}`)),
  {
    moduleId: "totem-observerdemo",
    repoName: "TotemObserverDemo",
    path: "src/client/java/dev/example/observerdemo/client/ObserverBeaconScreenAccessor.java",
    startLine: 1,
    symbols: ["ObserverBeaconScreenAccessor"],
    text: `package dev.example.observerdemo.client;
public interface ObserverBeaconScreenAccessor { }
`
  }
);

index.chunks.push(
  {
    moduleId: "totem-bridgedemo",
    repoName: "TotemBridgeDemo",
    path: "src/main/java/dev/example/bridgedemo/TotemBridgeDemo.java",
    startLine: 1,
    symbols: ["TotemBridgeDemo", "onInitialize"],
    text: `package dev.example.bridgedemo;
public final class TotemBridgeDemo implements ModInitializer {
  public void onInitialize() { }
}
`
  },
  {
    moduleId: "totem-bridgedemo",
    repoName: "TotemBridgeDemo",
    path: "src/main/java/dev/example/bridgedemo/domain/BridgeDomainService.java",
    startLine: 1,
    symbols: ["BridgeDomainService"],
    text: `package dev.example.bridgedemo.domain;
import dev.example.bridgedemo.TotemBridgeDemo;
public final class BridgeDomainService { TotemBridgeDemo owner; }
`
  },
  {
    moduleId: "totem-bridgedemo",
    repoName: "TotemBridgeDemo",
    path: "src/main/java/dev/example/bridgedemo/domain/DiscordEventPayload.java",
    startLine: 1,
    symbols: ["DiscordEventPayload"],
    text: `package dev.example.bridgedemo.domain;
public record DiscordEventPayload(String event, String message) { }
`
  },
  {
    moduleId: "totem-bridgedemo",
    repoName: "TotemBridgeDemo",
    path: "src/main/java/dev/example/bridgedemo/domain/DiscordEventTransport.java",
    startLine: 1,
    symbols: ["DiscordEventTransport", "send"],
    text: `package dev.example.bridgedemo.domain;
public interface DiscordEventTransport { void send(String event); }
`
  },
  {
    moduleId: "totem-bridgedemo",
    repoName: "TotemBridgeDemo",
    path: "src/main/java/dev/example/bridgedemo/network/RealPayload.java",
    startLine: 1,
    symbols: ["RealPayload", "type"],
    text: `package dev.example.bridgedemo.network;
public record RealPayload(String value) implements CustomPacketPayload { }
`
  },
  {
    moduleId: "totem-bridgedemo",
    repoName: "TotemBridgeDemo",
    path: "src/main/java/dev/example/bridgedemo/transport/JsonConfigFileStore.java",
    startLine: 1,
    symbols: ["JsonConfigFileStore", "save"],
    text: `package dev.example.bridgedemo.transport;
public final class JsonConfigFileStore {
  void save(Path path, String json) throws Exception { Files.writeString(path, json); }
}
`
  },
  {
    moduleId: "totem-bridgedemo",
    repoName: "TotemBridgeDemo",
    path: "src/main/java/dev/example/bridgedemo/domain/LanguageCacheDownloader.java",
    startLine: 1,
    symbols: ["LanguageCacheDownloader", "persist"],
    text: `package dev.example.bridgedemo.domain;
public final class LanguageCacheDownloader {
  void persist(Path path, byte[] bytes) throws Exception { Files.write(path, bytes); Files.move(path, path); }
}
`
  }
);

assert.equal(isProductionCode("src/main/java/a/A.java"), true);
assert.equal(isProductionCode("src/client/java/a/A.kt"), true);
assert.equal(isProductionCode("src/test/java/a/A.java"), false);
assert.equal(isProductionCode("README.md"), false);

const inventory = buildCodeInventory({ knowledge, index });
assert.equal(inventory.sourceScope, "production-code-only");
assert.equal(inventory.modules.length, 7);

const moduleA = inventory.modules.find((entry) => entry.moduleId === "totem-a");
assert.ok(moduleA);
assert.equal(moduleA.productionFileCount, 20);
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
const itemArea = moduleA.featureAreas.find((entry) => entry.key === "item");
const bookshelfArea = moduleA.featureAreas.find((entry) => entry.key === "bookshelf");
assert.ok(observerArea);
assert.ok(inventoryArea);
assert.ok(itemArea);
assert.ok(bookshelfArea);
assert.equal(observerArea.fileCount, 3);
assert.ok(observerArea.representativePaths.some((path) => path.endsWith("ObserverBeaconScreenClient.java")));
assert.ok(observerArea.representativePaths.some((path) => path.endsWith("ObserverUiClient.java")));
assert.equal(inventoryArea.fileCount, 2);
assert.ok(inventoryArea.representativePaths.some((path) => path.endsWith("ContainerSortClient.java")));
assert.equal(itemArea.fileCount, 1);
assert.equal(bookshelfArea.fileCount, 3);
assert.ok(bookshelfArea.representativePaths.some((path) => path.endsWith("RecipeManagerMixin.java")));
assert.ok(bookshelfArea.representativePaths.some((path) => path.endsWith("StructureTemplateMixin.java")));

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

const moduleC = inventory.modules.find((entry) => entry.moduleId === "totem-copperworks");
assert.ok(moduleC);
assert.equal(moduleC.productionFileCount, 39);
const gatheringArea = moduleC.featureAreas.find((entry) => entry.key === "gathering");
const sortingArea = moduleC.featureAreas.find((entry) => entry.key === "sorting");
const wrenchArea = moduleC.featureAreas.find((entry) => entry.key === "wrench");
const llmArea = moduleC.featureAreas.find((entry) => entry.key === "llm");
assert.ok(gatheringArea);
assert.ok(sortingArea);
assert.ok(wrenchArea);
assert.ok(llmArea);
assert.equal(gatheringArea.fileCount, 10);
assert.equal(sortingArea.fileCount, 8);
assert.equal(wrenchArea.fileCount, 5);
assert.equal(llmArea.fileCount, 5);
const menuAreaC = moduleC.featureAreas.find((entry) => entry.key === "menu");
const rootAreaC = moduleC.featureAreas.find((entry) => entry.key === "module-root");
assert.ok(menuAreaC);
assert.ok(rootAreaC);
assert.ok(menuAreaC.representativePaths.some((path) => path.endsWith("CopperGolemMenuScreenSession.java")));
assert.ok(menuAreaC.representativePaths.some((path) => path.endsWith("CopperGolemMenuPayloadBridge.java")));
assert.ok(rootAreaC.representativePaths.some((path) => path.endsWith("TotemCopperworks.java")));
for (const label of [
  "CopperGolemMenuPanelLayout",
  "CopperGolemMenuEditor",
  "CopperGolemMenuUiState",
  "CopperGolemMenuScreenSession"
]) {
  assert.ok(moduleC.surfaces.clientUi.some((entry) => entry.label === label), `${label} should be Client / UI evidence`);
}
assert.ok(!moduleC.surfaces.clientUi.some((entry) => entry.label === "CopperGolemClientPayloadRegistration"));
assert.ok(!moduleC.surfaces.clientUi.some((entry) => entry.label === "CopperGolemMenuPayloadBridge"));

const moduleD = inventory.modules.find((entry) => entry.moduleId === "totem-observerdemo");
assert.ok(moduleD);
assert.equal(moduleD.productionFileCount, 31);
assert.ok(moduleD.featureAreas.some((entry) => entry.key === "observer"));
assert.ok(!moduleD.featureAreas.some((entry) => ["relay", "session", "priority"].includes(entry.key)));
assert.ok(!moduleD.surfaces.clientUi.some((entry) => entry.label === "ObserverBeaconScreenAccessor"));

const bridgeDemo = inventory.modules.find((entry) => entry.moduleId === "totem-bridgedemo");
assert.ok(bridgeDemo);
assert.equal(bridgeDemo.productionFileCount, 7);
assert.ok(bridgeDemo.surfaces.entrypoints.some((entry) => entry.label === "TotemBridgeDemo"));
assert.ok(!bridgeDemo.surfaces.networking.some((entry) => entry.label === "DiscordEventPayload"));
assert.ok(!bridgeDemo.surfaces.networking.some((entry) => entry.label === "DiscordEventTransport"));
assert.ok(bridgeDemo.surfaces.networking.some((entry) => entry.label === "RealPayload"));
assert.ok(bridgeDemo.surfaces.persistence.some((entry) => entry.label === "JsonConfigFileStore"));
assert.ok(bridgeDemo.surfaces.persistence.some((entry) => entry.label === "LanguageCacheDownloader"));
const bridgeRootArea = bridgeDemo.featureAreas.find((entry) => entry.key === "module-root");
assert.ok(bridgeRootArea);
assert.ok(bridgeRootArea.representativePaths.some((path) => path.endsWith("TotemBridgeDemo.java")));

console.log("Code-first inventory validation passed.");
