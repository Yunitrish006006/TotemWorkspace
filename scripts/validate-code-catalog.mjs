#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCodeCatalog } from "../intelligence/code-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "modules.json"), "utf8"));
const catalog = loadCodeCatalog(ROOT);
const errors = [];
const seenModules = new Set();

function fail(message) {
  errors.push(message);
}

for (const reviewed of catalog.modules) {
  if (!reviewed.moduleId || seenModules.has(reviewed.moduleId)) {
    fail(`duplicate or blank reviewed module id: ${reviewed.moduleId || "<blank>"}`);
    continue;
  }
  seenModules.add(reviewed.moduleId);
  const module = (modules.modules ?? []).find((entry) => entry.id === reviewed.moduleId);
  if (!module) {
    fail(`${reviewed.moduleId}: not present in data/modules.json`);
    continue;
  }
  if (reviewed.schemaVersion !== 1) fail(`${reviewed.moduleId}: unsupported schemaVersion ${reviewed.schemaVersion}`);
  if (reviewed.reviewStatus !== "reviewed-from-production-code") {
    fail(`${reviewed.moduleId}: reviewStatus must be reviewed-from-production-code`);
  }
  if (reviewed.source.evidencePolicy !== "production-code-only") {
    fail(`${reviewed.moduleId}: evidencePolicy must be production-code-only`);
  }
  if (reviewed.source.ref !== module.commit) {
    fail(`${reviewed.moduleId}: reviewed ref ${reviewed.source.ref} does not match snapshot commit ${module.commit}`);
  }
  if (!reviewed.semanticGroups.length) fail(`${reviewed.moduleId}: semanticGroups is empty`);

  const ids = new Set();
  for (const group of reviewed.semanticGroups) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group.id)) fail(`${reviewed.moduleId}: invalid stable group id ${group.id}`);
    if (ids.has(group.id)) fail(`${reviewed.moduleId}: duplicate semantic group id ${group.id}`);
    ids.add(group.id);
    if (!group.name || !group.kind || !group.ownership || !group.summary) {
      fail(`${reviewed.moduleId}/${group.id}: missing semantic metadata`);
    }
    if (!group.evidence.length) fail(`${reviewed.moduleId}/${group.id}: no production evidence`);
    for (const evidence of group.evidence) {
      const normalized = evidence.path.replaceAll("\\", "/").toLowerCase();
      if (!(normalized.startsWith("src/main/") || normalized.startsWith("src/client/"))) {
        fail(`${reviewed.moduleId}/${group.id}: non-production evidence path ${evidence.path}`);
      }
      if (normalized.includes("/test/") || normalized.includes("/gametest/") || normalized.endsWith("readme.md")) {
        fail(`${reviewed.moduleId}/${group.id}: forbidden evidence path ${evidence.path}`);
      }
      if (!evidence.symbols.length) fail(`${reviewed.moduleId}/${group.id}: evidence ${evidence.path} has no symbols`);
    }
  }
}

const core = catalog.moduleById.get("totem-core");
if (!core) {
  fail("totem-core reviewed catalog is missing");
} else {
  const required = new Set([
    "shared-manual-platform",
    "versioned-event-contracts",
    "friendship-authority",
    "observer-semantic-screen-spi",
    "world-outline-voxel-wireframe",
    "death-integration-contracts",
    "legacy-item-decode-migration",
    "legacy-exact-version-gate",
    "shared-api-facilities"
  ]);
  for (const id of required) {
    if (!core.semanticGroups.some((group) => group.id === id)) fail(`totem-core: missing reviewed group ${id}`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Reviewed code catalog OK: ${catalog.modules.length} module(s), ${catalog.modules.reduce((sum, module) => sum + module.semanticGroups.length, 0)} semantic group(s)`);
