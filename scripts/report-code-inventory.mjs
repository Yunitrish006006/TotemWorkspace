#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildCodeInventory } from "../intelligence/code-inventory.mjs";
import { loadCodeIndex } from "../intelligence/code-index.mjs";
import { loadKnowledge } from "../intelligence/workspace-knowledge.mjs";

const strict = process.argv.includes("--strict");
const knowledge = loadKnowledge();
const index = loadCodeIndex({ knowledge });
if (!index) throw new Error("Code index is missing. Run build-index first.");

const inventory = buildCodeInventory({ knowledge, index });
const outputDir = path.join(knowledge.root, ".totem-index");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "code-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8");

const lines = [
  "# Totem code-first inventory",
  "",
  `Generated: ${inventory.generatedAt ?? "unknown"}`,
  "",
  "> Evidence policy: code areas/surfaces use production Java/Kotlin only. Production data JSON and localization JSON are reported separately as resource evidence. README and curated feature descriptions are excluded.",
  ""
];

for (const module of inventory.modules) {
  const present = index.modules?.find((entry) => entry.id === module.moduleId)?.present ?? false;
  lines.push(`## ${module.repoName || module.moduleId}`);
  lines.push("");
  lines.push(`- Module: \`${module.moduleId}\``);
  lines.push(`- Present in scan: ${present ? "yes" : "no"}`);
  lines.push(`- Production code files: ${module.productionFileCount}`);
  lines.push(`- Production resource evidence: ${module.resourceEvidence?.fileCount ?? 0}`);
  lines.push(`- Package root: ${module.packageRoot ? `\`${module.packageRoot}\`` : "n/a"}`);
  lines.push(`- Feature areas: ${module.featureAreas.length}`);
  lines.push(`- API / contract files: ${module.surfaces.api.length}`);
  lines.push(`- Networking: ${module.surfaces.networking.length}`);
  lines.push(`- Events / hooks: ${module.surfaces.events.length}`);
  lines.push(`- Commands: ${module.surfaces.commands.length}`);
  lines.push(`- Registries / bootstrap: ${module.surfaces.registries.length}`);
  lines.push(`- Persistence / codecs: ${module.surfaces.persistence.length}`);
  lines.push(`- Client / UI: ${module.surfaces.clientUi.length}`);
  lines.push(`- Mixins: ${module.surfaces.mixins.length}`);
  lines.push(`- Integration-signalling files: ${module.surfaces.integrations.length}`);
  lines.push("");

  if (module.resourceEvidence?.families?.length) {
    lines.push("### Production resource evidence");
    lines.push("");
    for (const family of module.resourceEvidence.families.slice(0, 16)) {
      lines.push(`- **${family.label}** — ${family.fileCount} files — ${family.representativePaths.slice(0, 4).map((entry) => `\`${entry}\``).join(", ")}`);
    }
    lines.push("");
  }

  if (module.featureAreas.length) {
    lines.push("### Feature areas");
    lines.push("");
    for (const area of module.featureAreas.slice(0, 16)) {
      const symbols = area.symbols.slice(0, 5).join(", ");
      lines.push(`- **${area.label}** — ${area.fileCount} files${symbols ? ` — ${symbols}` : ""}`);
    }
    lines.push("");
  }

  for (const [key, label] of Object.entries({
    api: "API / contracts",
    networking: "Networking",
    events: "Events / hooks",
    commands: "Commands",
    integrations: "Integration-signalling code"
  })) {
    const items = module.surfaces[key] ?? [];
    if (!items.length) continue;
    lines.push(`### ${label}`);
    lines.push("");
    for (const item of items.slice(0, 12)) {
      lines.push(`- \`${item.path}\` — ${item.label}${item.symbols.length ? ` — ${item.symbols.slice(0, 6).join(", ")}` : ""}`);
    }
    lines.push("");
  }

  if (module.crossModuleImports.length) {
    lines.push("### Cross-module imports");
    lines.push("");
    for (const link of module.crossModuleImports) {
      lines.push(`- **${link.targetModuleId}** — ${link.evidencePaths.slice(0, 5).map((entry) => `\`${entry}\``).join(", ")}`);
    }
    lines.push("");
  }
}

fs.writeFileSync(path.join(outputDir, "code-inventory.md"), `${lines.join("\n")}\n`, "utf8");

if (strict) {
  const presentIds = new Set((index.modules ?? []).filter((entry) => entry.present).map((entry) => entry.id));
  const missingProductionCode = inventory.modules
    .filter((module) => presentIds.has(module.moduleId) && module.productionFileCount === 0)
    .map((module) => module.moduleId);
  if (missingProductionCode.length) {
    throw new Error(`Present modules without production Java/Kotlin evidence: ${missingProductionCode.join(", ")}`);
  }
}

const totals = inventory.modules.reduce((sum, module) => ({
  files: sum.files + module.productionFileCount,
  areas: sum.areas + module.featureAreas.length,
  api: sum.api + module.surfaces.api.length,
  networking: sum.networking + module.surfaces.networking.length,
  events: sum.events + module.surfaces.events.length,
  resources: sum.resources + (module.resourceEvidence?.fileCount ?? 0)
}), { files: 0, areas: 0, api: 0, networking: 0, events: 0, resources: 0 });

process.stdout.write(`${JSON.stringify({
  sourceScope: inventory.sourceScope,
  resourceScope: inventory.resourceScope,
  modules: inventory.modules.length,
  ...totals,
  json: path.join(outputDir, "code-inventory.json"),
  markdown: path.join(outputDir, "code-inventory.md")
}, null, 2)}\n`);
