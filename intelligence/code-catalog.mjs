import fs from "node:fs";
import path from "node:path";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function freezeEvidence(evidence) {
  return Object.freeze((evidence ?? []).map((entry) => Object.freeze({
    path: String(entry.path ?? ""),
    symbols: Object.freeze([...(entry.symbols ?? [])].map(String))
  })));
}

function freezeGroup(group) {
  return Object.freeze({
    id: String(group.id ?? ""),
    name: String(group.name ?? ""),
    kind: String(group.kind ?? ""),
    ownership: String(group.ownership ?? ""),
    summary: String(group.summary ?? ""),
    publicSymbols: Object.freeze([...(group.publicSymbols ?? [])].map(String)),
    implementationSymbols: Object.freeze([...(group.implementationSymbols ?? [])].map(String)),
    notes: Object.freeze([...(group.notes ?? [])].map(String)),
    evidence: freezeEvidence(group.evidence)
  });
}

export function loadCodeCatalog(workspaceRoot) {
  const directory = path.join(workspaceRoot, "data", "code-catalog");
  if (!fs.existsSync(directory)) {
    return Object.freeze({ schemaVersion: 1, modules: Object.freeze([]), moduleById: new Map() });
  }

  const modules = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const raw = readJson(path.join(directory, name));
      return Object.freeze({
        schemaVersion: Number(raw.schemaVersion ?? 1),
        moduleId: String(raw.moduleId ?? ""),
        reviewStatus: String(raw.reviewStatus ?? ""),
        source: Object.freeze({
          repository: String(raw.source?.repository ?? ""),
          ref: String(raw.source?.ref ?? ""),
          productionRoots: Object.freeze([...(raw.source?.productionRoots ?? [])].map(String)),
          evidencePolicy: String(raw.source?.evidencePolicy ?? "")
        }),
        semanticGroups: Object.freeze((raw.semanticGroups ?? []).map(freezeGroup))
      });
    });

  return Object.freeze({
    schemaVersion: 1,
    modules: Object.freeze(modules),
    moduleById: new Map(modules.map((module) => [module.moduleId, module]))
  });
}
