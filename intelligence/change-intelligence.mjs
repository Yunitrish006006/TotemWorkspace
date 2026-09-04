import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { impactAnalysis } from "./workspace-knowledge.mjs";

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function stableValue(value) {
  if (Array.isArray(value)) {
    const normalized = value.map(stableValue);
    return normalized.every((entry) => typeof entry === "string")
      ? normalized.sort()
      : normalized;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value ?? null;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function entityRecord({ id, type, moduleId = null, payload }) {
  return Object.freeze({
    id,
    type,
    moduleId,
    fingerprint: fingerprint(payload)
  });
}

function relationPayload(entry) {
  return {
    type: entry.type ?? entry.family ?? "relation",
    from: entry.from ?? entry.providerModuleId ?? null,
    to: entry.to ?? entry.consumerModuleId ?? null,
    relatedNodes: [...(entry.relatedNodes ?? [])],
    featureIds: [...(entry.featureIds ?? [])],
    providerFeatureId: entry.providerFeatureId ?? null,
    consumerFeatureId: entry.consumerFeatureId ?? null,
    providerModuleId: entry.providerModuleId ?? null,
    consumerModuleId: entry.consumerModuleId ?? null
  };
}

export function semanticSnapshot(graph) {
  const entities = [];

  for (const module of graph?.modules ?? []) {
    entities.push(entityRecord({
      id: module.id,
      type: "module",
      moduleId: module.id,
      payload: {
        name: module.name,
        version: module.version,
        role: module.role,
        featureGroups: [...(module.featureGroups ?? [])]
      }
    }));
  }

  for (const feature of graph?.features ?? []) {
    entities.push(entityRecord({
      id: feature.id,
      type: "feature",
      moduleId: feature.ownerId ?? null,
      payload: {
        ownerId: feature.ownerId,
        title: feature.title,
        summary: feature.summary,
        softContractIds: [...(feature.softContractIds ?? [])],
        serviceContractIds: [...(feature.serviceContractIds ?? [])],
        eventContractIds: [...(feature.eventContractIds ?? [])]
      }
    }));
  }

  for (const component of graph?.components ?? []) {
    entities.push(entityRecord({
      id: component.id,
      type: "component",
      moduleId: component.moduleId ?? null,
      payload: {
        key: component.key,
        label: component.label,
        responsibility: component.responsibility,
        featureIds: [...(component.featureIds ?? [])],
        mappingConfidence: component.mappingConfidence,
        implementationPaths: [...(component.implementationPaths ?? [])].map(normalizePath),
        surfaceKinds: [...(component.surfaceKinds ?? [])]
      }
    }));
  }

  for (const node of graph?.code?.nodes ?? []) {
    if (node.type !== "code-file") continue;
    entities.push(entityRecord({
      id: node.id,
      type: "implementation",
      moduleId: node.moduleId ?? null,
      payload: {
        moduleId: node.moduleId,
        category: node.category,
        path: normalizePath(node.path),
        symbolCount: node.symbolCount ?? 0
      }
    }));
  }

  for (const contract of graph?.contracts ?? []) {
    entities.push(entityRecord({
      id: contract.id,
      type: "relation",
      moduleId: null,
      payload: relationPayload(contract)
    }));
  }

  for (const capability of graph?.sharedCapabilities ?? []) {
    entities.push(entityRecord({
      id: capability.id,
      type: "relation",
      moduleId: capability.providerModuleId ?? null,
      payload: relationPayload(capability)
    }));
  }

  entities.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: graph?.generatedAt ?? null,
    entities: Object.freeze(entities)
  });
}

function publicEntity(entity) {
  return Object.freeze({
    id: entity.id,
    type: entity.type,
    moduleId: entity.moduleId ?? null
  });
}

export function diffSemanticSnapshots(before, after) {
  const beforeById = new Map((before?.entities ?? []).map((entry) => [entry.id, entry]));
  const afterById = new Map((after?.entities ?? []).map((entry) => [entry.id, entry]));
  const added = [];
  const removed = [];
  const modified = [];

  for (const [id, current] of afterById) {
    const previous = beforeById.get(id);
    if (!previous) {
      added.push(publicEntity(current));
      continue;
    }
    if (previous.type !== current.type || previous.fingerprint !== current.fingerprint) {
      modified.push(publicEntity(current));
    }
  }

  for (const [id, previous] of beforeById) {
    if (!afterById.has(id)) removed.push(publicEntity(previous));
  }

  const sort = (entries) => entries.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  return Object.freeze({
    schemaVersion: 1,
    added: Object.freeze(sort(added)),
    modified: Object.freeze(sort(modified)),
    removed: Object.freeze(sort(removed)),
    changedEntityIds: Object.freeze([...new Set([...added, ...modified, ...removed].map((entry) => entry.id))])
  });
}

function graphSemanticCoordinates(graph) {
  const components = graph?.components ?? [];
  const implementations = (graph?.code?.nodes ?? []).filter((node) => node.type === "code-file");
  return { components, implementations };
}

export function mapGitChangesToSemantic(gitChanges, { beforeGraph, afterGraph } = {}) {
  const before = graphSemanticCoordinates(beforeGraph);
  const after = graphSemanticCoordinates(afterGraph);
  const components = [...before.components, ...after.components];
  const implementations = [...before.implementations, ...after.implementations];

  return Object.freeze((gitChanges ?? []).map((change) => {
    const changedPath = normalizePath(change.path);
    const componentIds = new Set();
    const featureIds = new Set();
    const implementationIds = new Set();

    for (const component of components) {
      if (component.moduleId !== change.moduleId) continue;
      const paths = (component.implementationPaths ?? []).map(normalizePath);
      if (!paths.includes(changedPath)) continue;
      componentIds.add(component.id);
      for (const featureId of component.featureIds ?? []) featureIds.add(featureId);
    }

    for (const implementation of implementations) {
      if (implementation.moduleId !== change.moduleId) continue;
      if (normalizePath(implementation.path) === changedPath) implementationIds.add(implementation.id);
    }

    return Object.freeze({
      moduleId: change.moduleId,
      repoName: change.repoName,
      path: changedPath,
      status: change.status ?? "M",
      previousPath: change.previousPath ? normalizePath(change.previousPath) : null,
      componentIds: Object.freeze([...componentIds].sort()),
      featureIds: Object.freeze([...featureIds].sort()),
      implementationIds: Object.freeze([...implementationIds].sort())
    });
  }));
}

function gitOutput(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024
    });
  } catch {
    return "";
  }
}

function trackedChanges(repoPath) {
  const tokens = gitOutput(repoPath, ["diff", "--name-status", "-z", "HEAD", "--"]).split("\0");
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) break;
    if (/^[RC]/.test(status)) {
      const previousPath = tokens[index++] ?? "";
      const nextPath = tokens[index++] ?? "";
      if (nextPath) changes.push({ status: status[0], previousPath, path: nextPath });
    } else {
      const changedPath = tokens[index++] ?? "";
      if (changedPath) changes.push({ status: status[0] || "M", path: changedPath });
    }
  }
  return changes;
}

function untrackedChanges(repoPath) {
  return gitOutput(repoPath, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((file) => ({ status: "A", path: file }));
}

export function collectGitChanges({
  knowledge,
  reposRoot,
  modules = []
} = {}) {
  const selected = new Set((modules ?? []).filter(Boolean));
  const out = [];

  for (const module of knowledge?.modules ?? []) {
    if (selected.size && !selected.has(module.id)) continue;
    const repoPath = path.join(reposRoot, module.repoName);
    if (!fs.existsSync(path.join(repoPath, ".git"))) continue;

    const byPath = new Map();
    for (const change of [...trackedChanges(repoPath), ...untrackedChanges(repoPath)]) {
      byPath.set(normalizePath(change.path), change);
    }

    for (const change of byPath.values()) {
      out.push(Object.freeze({
        moduleId: module.id,
        repoName: module.repoName,
        status: change.status,
        path: normalizePath(change.path),
        previousPath: change.previousPath ? normalizePath(change.previousPath) : null
      }));
    }
  }

  out.sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.path.localeCompare(b.path));
  return Object.freeze(out);
}

function changedModulesFromDiff(diff) {
  return new Set(
    [...(diff?.added ?? []), ...(diff?.modified ?? []), ...(diff?.removed ?? [])]
      .map((entry) => entry.moduleId)
      .filter(Boolean)
  );
}

function safeImpact({ knowledge, gitChanges, semanticDiff }) {
  const changedModules = changedModulesFromDiff(semanticDiff);
  for (const entry of gitChanges ?? []) changedModules.add(entry.moduleId);
  if (!changedModules.size) {
    return Object.freeze({
      touchedModules: Object.freeze([]),
      impactedModules: Object.freeze([]),
      contractIds: Object.freeze([]),
      risks: Object.freeze([]),
      requiresIndependentReview: false
    });
  }

  const changedFiles = (gitChanges ?? []).map((entry) => `${entry.repoName}/${entry.path}`);
  const impact = impactAnalysis({
    changedFiles,
    changedModules: [...changedModules]
  }, knowledge);
  return Object.freeze({
    touchedModules: impact.touchedModules,
    impactedModules: impact.impactedModules,
    contractIds: Object.freeze(impact.contracts.map((contract) => contract.id)),
    risks: impact.risks,
    requiresIndependentReview: impact.requiresIndependentReview
  });
}

export function buildChangeIntelligence({
  knowledge,
  beforeGraph,
  afterGraph,
  gitChanges = []
} = {}) {
  const before = semanticSnapshot(beforeGraph);
  const after = semanticSnapshot(afterGraph);
  const semanticDiff = diffSemanticSnapshots(before, after);
  const mappedGitChanges = mapGitChangesToSemantic(gitChanges, { beforeGraph, afterGraph });
  const impact = safeImpact({ knowledge, gitChanges: mappedGitChanges, semanticDiff });

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    before: Object.freeze({
      generatedAt: before.generatedAt,
      entityCount: before.entities.length
    }),
    after: Object.freeze({
      generatedAt: after.generatedAt,
      entityCount: after.entities.length
    }),
    gitChanges: mappedGitChanges,
    semanticDiff,
    impact
  });
}

export function changeIntelligencePath(workspaceRoot) {
  return path.join(workspaceRoot, ".totem-index", "change-intelligence.json");
}

export function saveChangeIntelligence(workspaceRoot, value) {
  const filePath = changeIntelligencePath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
  return value;
}

export function loadChangeIntelligence(workspaceRoot) {
  try {
    return JSON.parse(fs.readFileSync(changeIntelligencePath(workspaceRoot), "utf8"));
  } catch {
    return null;
  }
}
