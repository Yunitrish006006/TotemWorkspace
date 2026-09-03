#!/usr/bin/env node
import fs from "node:fs";

const rendererPath = "viewer/graph-v2-cluster-v2.js";
const validatorPath = "scripts/validate-3d-cluster.mjs";

let source = fs.readFileSync(rendererPath, "utf8");

if (!source.includes("function modulePosition")) {
  const marker = "  function isRetargetable(contract) {";
  const helper = `  function modulePosition(module, peripheralIndex, peripheralCount, radius) {\n    if (module.id === \"totem-core\") return { x: 0, y: 0, z: 0 };\n    return fib(peripheralIndex, peripheralCount, radius);\n  }\n\n`;
  if (!source.includes(marker)) throw new Error("modulePosition insertion marker missing");
  source = source.replace(marker, helper + marker);
}

const layoutStart = source.indexOf("    var sortedModules = modules.slice().sort");
const layoutEnd = source.indexOf("    externals.slice().sort", layoutStart);
if (layoutStart < 0 || layoutEnd < 0) throw new Error("module layout block not found");

const centeredLayout = `    var coreModule = modules.find(function (module) { return module.id === \"totem-core\"; });\n    var peripheralModules = modules.filter(function (module) { return module.id !== \"totem-core\"; }).sort(function (a, b) {\n      return (a.name || a.id).localeCompare(b.name || b.id);\n    });\n\n    if (coreModule) {\n      var corePosition = modulePosition(coreModule, 0, peripheralModules.length, moduleRadius);\n      nodes.push({\n        id: coreModule.id,\n        label: coreModule.name || coreModule.id,\n        type: \"module\",\n        rank: rankOf(coreModule),\n        ownerId: coreModule.id,\n        x: corePosition.x,\n        y: corePosition.y,\n        z: corePosition.z,\n        source: coreModule\n      });\n    }\n\n    peripheralModules.forEach(function (module, index) {\n      var position = modulePosition(module, index, peripheralModules.length, moduleRadius);\n      nodes.push({\n        id: module.id,\n        label: module.name || module.id,\n        type: \"module\",\n        rank: rankOf(module),\n        ownerId: module.id,\n        x: position.x,\n        y: position.y,\n        z: position.z,\n        source: module\n      });\n    });\n\n`;
source = source.slice(0, layoutStart) + centeredLayout + source.slice(layoutEnd);

if (!source.includes("modulePosition: modulePosition")) {
  const exportMarker = "    moduleOrbitRadius: moduleOrbitRadius,\n    scatter: scatter,";
  if (!source.includes(exportMarker)) throw new Error("renderer export marker missing");
  source = source.replace(exportMarker, "    moduleOrbitRadius: moduleOrbitRadius,\n    modulePosition: modulePosition,\n    scatter: scatter,");
}

fs.writeFileSync(rendererPath, source);

let validator = fs.readFileSync(validatorPath, "utf8");
if (!validator.includes('"function modulePosition"')) {
  validator = validator.replace('  "function moduleOrbitRadius",\n', '  "function moduleOrbitRadius",\n  "function modulePosition",\n');
}

const coreAssertions = `\n// Core topology regression: TotemCore is the fixed world-space center and only non-Core modules use the orbit.\nassert.ok(source.includes('if (module.id === "totem-core") return { x: 0, y: 0, z: 0 };'), "TotemCore must be anchored to the 3D world origin");\nassert.ok(source.includes('var coreModule = modules.find(function (module) { return module.id === "totem-core"; });'), "scene must resolve Core separately from the peripheral orbit");\nassert.ok(source.includes('module.id !== "totem-core"'), "peripheral module orbit must exclude TotemCore");\nassert.ok(source.includes("modulePosition(coreModule, 0, peripheralModules.length, moduleRadius)"), "scene must place Core through the center-aware position helper");\nassert.ok(source.includes("modulePosition: modulePosition"), "Core-centered module positioning must remain exposed for renderer regression inspection");\n`;
const anchor = "\nassert.deepEqual(audit.contractOverrides";
if (!validator.includes("Core topology regression")) {
  if (!validator.includes(anchor)) throw new Error("validator assertion marker missing");
  validator = validator.replace(anchor, coreAssertions + anchor);
}
validator = validator.replace(
  "3D cluster v2 validation passed: deterministic clusters, dynamic spacing, audited Core friendship retargeting, symmetric Shared Manual endpoints, desktop right-drag camera pan, touch gestures, spotlight integration, and Pages packaging are present.",
  "3D cluster v2 validation passed: Core-centered topology, deterministic clusters, dynamic spacing, audited Core friendship retargeting, symmetric Shared Manual endpoints, desktop right-drag camera pan, touch gestures, spotlight integration, and Pages packaging are present."
);
fs.writeFileSync(validatorPath, validator);
