import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..");

export const MODULE_KEY_TO_ID = Object.freeze({
  core: "totem-core",
  alchemy: "totem-alchemy",
  enchanting: "totem-enchanting",
  discord: "totem-discord-bridge",
  automata: "totem-automata",
  vanilla: "totem-vanilla-tweaks",
  excavation: "totem-excavation",
  villagers: "totem-villagers",
  locksmith: "totem-locksmith",
  nexus: "totem-nexus",
  remnant: "totem-remnant"
});

const ID_TO_MODULE_KEY = Object.freeze(Object.fromEntries(
  Object.entries(MODULE_KEY_TO_ID).map(([key, id]) => [id, key])
));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function evaluateLiteral(source, label) {
  try {
    return Function(`"use strict"; return (${source});`)();
  } catch (error) {
    throw new Error(`${label} cannot be parsed: ${error.message}`);
  }
}

function extractLiteral(html, regex, label) {
  const match = html.match(regex);
  if (!match) throw new Error(`index.html is missing ${label}`);
  return evaluateLiteral(match[1], label);
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

export function tokenize(value) {
  const text = normalizeText(value);
  const tokens = text.match(/[\p{L}\p{N}_@.+-]+/gu) ?? [];
  const expanded = [];
  for (const token of tokens) {
    expanded.push(token);
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 2) {
      for (let index = 0; index < token.length - 1; index += 1) {
        expanded.push(token.slice(index, index + 2));
      }
    }
  }
  return [...new Set(expanded.filter((token) => token.length > 1))];
}

function scoreText(query, tokens, fields, boosts = {}) {
  const joined = fields.filter(Boolean).map(normalizeText).join("\n");
  if (!joined) return 0;
  let score = 0;
  const normalizedQuery = normalizeText(query).trim();
  if (normalizedQuery && joined.includes(normalizedQuery)) score += boosts.exact ?? 12;
  for (const token of tokens) {
    if (!joined.includes(token)) continue;
    score += boosts.token ?? 2;
  }
  return score;
}

function repoName(module) {
  try {
    const parsed = new URL(module.repository);
    return path.basename(parsed.pathname.replace(/\/$/, ""));
  } catch {
    return module.name;
  }
}

function normalizeNodeId(value) {
  if (!value) return null;
  if (MODULE_KEY_TO_ID[value]) return MODULE_KEY_TO_ID[value];
  if (String(value).startsWith("totem-")) return String(value);
  return `external:${String(value)}`;
}

function applyRelationshipModuleOverrides(modulesData, relationshipAudit) {
  const overrides = relationshipAudit?.moduleOverrides ?? {};
  return {
    ...modulesData,
    modules: (modulesData.modules ?? []).map((module) => {
      const override = overrides[module.id];
      if (!override) return module;
      return {
        ...module,
        ...override,
        observerProviders: override.observerProviders ?? module.observerProviders ?? []
      };
    })
  };
}

function relationshipField(channel) {
  if (channel === "soft") return "softContractIds";
  if (channel === "service") return "serviceContractIds";
  if (channel === "event") return "eventContractIds";
  return null;
}

function applyRelationshipFeatureOverrides(features, relationshipAudit) {
  const entries = Object.entries(relationshipAudit?.contractOverrides ?? {})
    .map(([id, override]) => ({ id, ...override, field: relationshipField(override.channel) }))
    .filter((entry) => entry.field);
  const auditedIdsByField = new Map();
  for (const entry of entries) {
    if (!auditedIdsByField.has(entry.field)) auditedIdsByField.set(entry.field, new Set());
    auditedIdsByField.get(entry.field).add(entry.id);
  }

  return Object.freeze(features.map((feature) => {
    const next = {
      ...feature,
      softContractIds: [...feature.softContractIds],
      serviceContractIds: [...feature.serviceContractIds],
      eventContractIds: [...feature.eventContractIds]
    };
    for (const [field, auditedIds] of auditedIdsByField) {
      next[field] = next[field].filter((id) => !auditedIds.has(id));
    }
    for (const entry of entries) {
      if ((entry.featureIds ?? []).includes(feature.id)) next[entry.field].push(entry.id);
    }
    next.softContractIds = Object.freeze([...new Set(next.softContractIds)]);
    next.serviceContractIds = Object.freeze([...new Set(next.serviceContractIds)]);
    next.eventContractIds = Object.freeze([...new Set(next.eventContractIds)]);
    return Object.freeze(next);
  }));
}

function applyRelationshipContractOverrides(contracts, relationshipAudit) {
  const overrides = relationshipAudit?.contractOverrides ?? {};
  const seen = new Set();
  const result = contracts.map((contract) => {
    const override = overrides[contract.id];
    if (!override) return contract;
    seen.add(contract.id);
    const { channel, ...patch } = override;
    return Object.freeze({
      ...contract,
      ...patch,
      featureIds: Object.freeze([...(patch.featureIds ?? contract.featureIds ?? [])])
    });
  });
  const missing = Object.keys(overrides).filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`relationship audit references unknown contracts: ${missing.join(", ")}`);
  return Object.freeze(result);
}

function buildFeatureRecords({ modules, moduleDetails, activeModuleIds, featureBranchRules }) {
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const features = [];

  for (const ownerKey of activeModuleIds) {
    const ownerId = MODULE_KEY_TO_ID[ownerKey];
    if (!ownerId || !moduleById.has(ownerId)) continue;
    const detail = moduleDetails[ownerKey];
    if (!detail || !Array.isArray(detail.branches)) continue;
    const rules = Array.isArray(featureBranchRules[ownerKey]) ? featureBranchRules[ownerKey] : [];

    detail.branches.forEach((summary, index) => {
      const rule = rules[index] ?? {};
      const title = String(summary).split("：", 1)[0].trim() || `feature-${index + 1}`;
      features.push(Object.freeze({
        id: `${ownerId}.feature-${index + 1}`,
        ownerId,
        ownerKey,
        index: index + 1,
        title,
        summary: String(summary),
        softContractIds: Object.freeze([...(rule.softIds ?? [])]),
        serviceContractIds: Object.freeze([...(rule.serviceIds ?? [])]),
        eventContractIds: Object.freeze([...(rule.eventIds ?? [])])
      }));
    });
  }
  return Object.freeze(features);
}

function buildContractRecords({ modulesData, softDependencyAudit, externalServiceAudit, eventBusCompatibilityNotes, features }) {
  const contracts = [];
  const featureIdsFor = (kind, id) => features
    .filter((feature) => feature[kind]?.includes(id))
    .map((feature) => feature.id);

  for (const module of modulesData.modules ?? []) {
    if (!module.coreDependency || module.id === "totem-core") continue;
    contracts.push(Object.freeze({
      id: `hard:${module.id}:totem-core`,
      type: "hard-core",
      from: module.id,
      to: "totem-core",
      version: module.coreDependency,
      feature: `${module.name} requires TotemCore ${module.coreDependency}`,
      fallback: null,
      featureIds: Object.freeze([])
    }));
  }

  for (const entry of softDependencyAudit ?? []) {
    contracts.push(Object.freeze({
      id: entry.id,
      type: entry.classification?.startsWith("A｜") ? "fabric-suggests" : "runtime-optional",
      classification: entry.classification ?? null,
      from: normalizeNodeId(entry.sourceId),
      to: normalizeNodeId(entry.targetId),
      source: entry.source ?? null,
      target: entry.target ?? null,
      feature: entry.feature ?? null,
      fallback: entry.fallback ?? null,
      evidence: entry.evidence ?? null,
      featureIds: Object.freeze(featureIdsFor("softContractIds", entry.id))
    }));
  }

  for (const entry of externalServiceAudit ?? []) {
    contracts.push(Object.freeze({
      id: entry.id,
      type: "external-service",
      classification: entry.classification ?? "external-service",
      from: normalizeNodeId(entry.sourceId),
      to: normalizeNodeId(entry.targetId),
      source: entry.source ?? null,
      target: entry.target ?? null,
      feature: entry.feature ?? null,
      fallback: entry.fallback ?? null,
      evidence: entry.evidence ?? null,
      featureIds: Object.freeze(featureIdsFor("serviceContractIds", entry.id))
    }));
  }

  for (const [id, entry] of Object.entries(eventBusCompatibilityNotes ?? {})) {
    const related = (entry.relatedIds ?? []).map(normalizeNodeId).filter(Boolean);
    contracts.push(Object.freeze({
      id,
      type: "eventbus",
      classification: entry.classification ?? "EventBus",
      from: related[0] ?? null,
      to: related.at(-1) ?? null,
      relatedNodes: Object.freeze(related),
      feature: entry.description ?? null,
      fallback: entry.fallback ?? null,
      featureIds: Object.freeze(featureIdsFor("eventContractIds", id))
    }));
  }

  for (const module of modulesData.modules ?? []) {
    for (const provider of module.observerProviders ?? []) {
      contracts.push(Object.freeze({
        id: `observer:${module.id}:${provider.family}@${provider.protocol}`,
        type: "observer-provider",
        from: "totem-vanilla-tweaks",
        to: module.id,
        providerOwner: module.id,
        family: provider.family,
        protocol: provider.protocol,
        variants: Object.freeze([...(provider.variants ?? [])]),
        feature: `Observer provider ${provider.family} protocol ${provider.protocol}`,
        fallback: "Missing or incompatible provider must report unsupported metadata; no mirror Screen.",
        featureIds: Object.freeze([])
      }));
    }
  }

  return Object.freeze(contracts);
}

function parseHtmlKnowledge(root) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const moduleDetails = extractLiteral(
    html,
    /var moduleDetails = (\{[\s\S]*?\n  \});\s*\n\s*var activeModuleIds/,
    "moduleDetails"
  );
  const activeModuleIds = extractLiteral(
    html,
    /var activeModuleIds = (\[[\s\S]*?\]);\s*\n\s*var overviewNodeLayout/,
    "activeModuleIds"
  );
  const softDependencyAudit = extractLiteral(
    html,
    /var softDependencyAudit = (\[[\s\S]*?\n  \]);\s*\n\s*var externalServiceAudit/,
    "softDependencyAudit"
  );
  const externalServiceAudit = extractLiteral(
    html,
    /var externalServiceAudit = (\[[\s\S]*?\n  \]);\s*\n\s*var moduleDetails/,
    "externalServiceAudit"
  );
  const eventBusCompatibilityNotes = extractLiteral(
    html,
    /var eventBusCompatibilityNotes = (\{[\s\S]*?\n  \});\s*\n\s*var featureBranchRules/,
    "eventBusCompatibilityNotes"
  );
  const featureBranchRules = extractLiteral(
    html,
    /var featureBranchRules = (\{[\s\S]*?\n  \});\s*\n\s*var featureBranchData/,
    "featureBranchRules"
  );
  return { moduleDetails, activeModuleIds, softDependencyAudit, externalServiceAudit, eventBusCompatibilityNotes, featureBranchRules };
}

export function defaultWorkspaceRoot() {
  return path.resolve(process.env.TOTEM_WORKSPACE_ROOT || DEFAULT_ROOT);
}

export function defaultReposRoot(workspaceRoot = defaultWorkspaceRoot()) {
  return path.resolve(process.env.TOTEM_REPOS_ROOT || path.dirname(workspaceRoot));
}

export function loadKnowledge(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const modulesData = readJson(path.join(root, "data", "modules.json"));
  const relationshipAudit = readJson(path.join(root, "data", "relationship-audit.json"));
  const auditedModulesData = applyRelationshipModuleOverrides(modulesData, relationshipAudit);
  const aliasesData = readJson(path.join(root, "data", "aliases.json"));
  const testMatrix = readJson(path.join(root, "data", "test-matrix.json"));
  const htmlData = parseHtmlKnowledge(root);
  const modules = Object.freeze((auditedModulesData.modules ?? []).map((module) => Object.freeze({
    ...module,
    repoName: repoName(module),
    graphKey: ID_TO_MODULE_KEY[module.id] ?? null
  })));
  const rawFeatures = buildFeatureRecords({ modules, ...htmlData });
  const features = applyRelationshipFeatureOverrides(rawFeatures, relationshipAudit);
  const rawContracts = buildContractRecords({ modulesData: auditedModulesData, features, ...htmlData });
  const contracts = applyRelationshipContractOverrides(rawContracts, relationshipAudit);
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));

  return Object.freeze({
    root,
    snapshot: Object.freeze({ ...(modulesData.snapshot ?? {}) }),
    relationshipAudit: Object.freeze({ ...relationshipAudit }),
    modules,
    features,
    contracts,
    aliases: Object.freeze(aliasesData.aliases ?? {}),
    testMatrix: Object.freeze(testMatrix),
    moduleById,
    featureById,
    contractById
  });
}

function expandedQuery(knowledge, query) {
  const extras = [];
  const normalized = normalizeText(query);
  for (const [alias, targets] of Object.entries(knowledge.aliases)) {
    if (!normalized.includes(normalizeText(alias))) continue;
    extras.push(...(Array.isArray(targets) ? targets : [targets]));
  }
  return [query, ...extras].join(" ");
}

function moduleSearchScore(module, query, tokens) {
  let score = scoreText(query, tokens, [
    module.id,
    module.name,
    module.role,
    ...(module.featureGroups ?? []),
    module.repoName
  ]);
  if (tokens.includes(normalizeText(module.id))) score += 10;
  return score;
}

function featureSearchScore(feature, query, tokens) {
  return scoreText(query, tokens, [
    feature.id,
    feature.ownerId,
    feature.title,
    feature.summary,
    ...feature.softContractIds,
    ...feature.serviceContractIds,
    ...feature.eventContractIds
  ], { exact: 15, token: 3 });
}

function contractSearchScore(contract, query, tokens) {
  return scoreText(query, tokens, [
    contract.id,
    contract.type,
    contract.classification,
    contract.from,
    contract.to,
    contract.source,
    contract.target,
    contract.feature,
    contract.fallback,
    contract.evidence,
    contract.family,
    contract.implementationStatus,
    contract.auditStatus,
    contract.auditNote,
    ...(contract.featureIds ?? [])
  ], { exact: 14, token: 3 });
}

function contractNodes(contract) {
  return [...new Set([
    contract.from,
    contract.to,
    ...(contract.relatedNodes ?? [])
  ].filter(Boolean))];
}

function moduleNeighbors(knowledge, moduleId) {
  const related = [];
  for (const contract of knowledge.contracts) {
    const nodes = contractNodes(contract);
    if (!nodes.includes(moduleId)) continue;
    for (const node of nodes) {
      if (node !== moduleId && knowledge.moduleById.has(node)) related.push(node);
    }
  }
  return [...new Set(related)];
}

function riskTagsForText(knowledge, text) {
  const normalized = normalizeText(text);
  const tags = new Set();
  for (const rule of knowledge.testMatrix.riskRules ?? []) {
    if ((rule.match ?? []).some((term) => normalized.includes(normalizeText(term)))) {
      for (const tag of rule.tags ?? []) tags.add(tag);
    }
  }
  return [...tags];
}

function recommendedAgents({ modules, contracts, risks }) {
  const agents = [];
  if (modules.length > 1 || contracts.length > 0) agents.push("explorer");
  if (modules.includes("totem-core") || contracts.some((contract) => ["hard-core", "runtime-optional", "observer-provider", "eventbus"].includes(contract.type))) {
    agents.push("architecture/core-specialist");
  }
  if (risks.some((tag) => ["fabric-compat", "client-server", "observer"].includes(tag))) {
    agents.push("fabric-compatibility-specialist");
  }
  if (modules.length > 1) agents.push("bounded-module-workers");
  if (modules.length > 1 || risks.length > 1) agents.push("integration-reviewer");
  return [...new Set(agents)];
}

export function resolveTask(query, knowledge = loadKnowledge()) {
  if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
  const expanded = expandedQuery(knowledge, query);
  const tokens = tokenize(expanded);

  const rankedModules = knowledge.modules
    .map((module) => ({ module, score: moduleSearchScore(module, expanded, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const rankedFeatures = knowledge.features
    .map((feature) => ({ feature, score: featureSearchScore(feature, expanded, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const rankedContracts = knowledge.contracts
    .map((contract) => ({ contract, score: contractSearchScore(contract, expanded, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const modules = new Set(rankedModules.slice(0, 4).map(({ module }) => module.id));
  for (const { feature } of rankedFeatures.slice(0, 6)) modules.add(feature.ownerId);
  for (const { contract } of rankedContracts.slice(0, 5)) {
    for (const node of contractNodes(contract)) {
      if (knowledge.moduleById.has(node)) modules.add(node);
    }
  }

  if (modules.size === 1) {
    const only = [...modules][0];
    for (const neighbor of moduleNeighbors(knowledge, only).slice(0, 2)) {
      const directMention = tokens.some((token) => normalizeText(neighbor).includes(token));
      if (directMention) modules.add(neighbor);
    }
  }

  const moduleList = [...modules].slice(0, 7);
  const relevantContracts = knowledge.contracts.filter((contract) => (
    contractNodes(contract).some((node) => moduleList.includes(node))
    && (rankedContracts.some((entry) => entry.contract.id === contract.id)
      || contract.featureIds?.some((id) => rankedFeatures.some((entry) => entry.feature.id === id)))
  )).slice(0, 12);
  const risks = riskTagsForText(knowledge, [query, ...rankedFeatures.map((entry) => entry.feature.summary)].join(" "));

  return Object.freeze({
    query,
    expandedQuery: expanded,
    snapshot: knowledge.snapshot,
    modules: Object.freeze(moduleList.map((id) => {
      const ranked = rankedModules.find((entry) => entry.module.id === id);
      const module = knowledge.moduleById.get(id);
      return Object.freeze({ id, name: module?.name ?? id, role: module?.role ?? null, score: ranked?.score ?? 0 });
    })),
    features: Object.freeze(rankedFeatures.slice(0, 8).map(({ feature, score }) => Object.freeze({ ...feature, score }))),
    contracts: Object.freeze(relevantContracts),
    risks: Object.freeze(risks),
    recommendedAgents: Object.freeze(recommendedAgents({ modules: moduleList, contracts: relevantContracts, risks }))
  });
}

export function graphForModule(moduleId, { depth = 1, knowledge = loadKnowledge() } = {}) {
  if (!knowledge.moduleById.has(moduleId)) throw new Error(`Unknown Totem module: ${moduleId}`);
  const maxDepth = Math.max(1, Math.min(Number(depth) || 1, 4));
  const visited = new Set([moduleId]);
  let frontier = [moduleId];
  const contracts = new Map();

  for (let level = 0; level < maxDepth; level += 1) {
    const next = [];
    for (const current of frontier) {
      for (const contract of knowledge.contracts) {
        const nodes = contractNodes(contract);
        if (!nodes.includes(current)) continue;
        contracts.set(contract.id, contract);
        for (const node of nodes) {
          if (!knowledge.moduleById.has(node) || visited.has(node)) continue;
          visited.add(node);
          next.push(node);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return Object.freeze({
    root: moduleId,
    depth: maxDepth,
    modules: Object.freeze([...visited].map((id) => knowledge.moduleById.get(id))),
    contracts: Object.freeze([...contracts.values()])
  });
}

function detectModulesFromFiles(knowledge, changedFiles) {
  const modules = new Set();
  for (const file of changedFiles ?? []) {
    const normalized = normalizeText(file).replaceAll("\\", "/");
    for (const module of knowledge.modules) {
      if (normalized.includes(normalizeText(module.repoName)) || normalized.includes(normalizeText(module.id))) {
        modules.add(module.id);
      }
    }
  }
  return modules;
}

export function impactAnalysis({ changedFiles = [], changedModules = [] } = {}, knowledge = loadKnowledge()) {
  const touched = new Set((changedModules ?? []).filter((id) => knowledge.moduleById.has(id)));
  for (const id of detectModulesFromFiles(knowledge, changedFiles)) touched.add(id);
  if (touched.size === 0) throw new Error("impact analysis needs changedFiles or changedModules that identify a Totem module");

  const impacted = new Set(touched);
  const contracts = [];
  for (const contract of knowledge.contracts) {
    const nodes = contractNodes(contract);
    if (!nodes.some((node) => touched.has(node))) continue;
    contracts.push(contract);
    for (const node of nodes) {
      if (knowledge.moduleById.has(node)) impacted.add(node);
    }
  }
  if (touched.has("totem-core")) {
    for (const module of knowledge.modules) impacted.add(module.id);
  }

  const riskText = [...changedFiles, ...changedModules, ...contracts.flatMap((contract) => [contract.id, contract.type, contract.feature])].join(" ");
  const risks = riskTagsForText(knowledge, riskText);
  if (touched.has("totem-core")) risks.push("shared-contract");

  return Object.freeze({
    touchedModules: Object.freeze([...touched]),
    impactedModules: Object.freeze([...impacted]),
    contracts: Object.freeze(contracts),
    risks: Object.freeze([...new Set(risks)]),
    requiresIndependentReview: impacted.size > 1 || contracts.length > 0,
    recommendedAgents: Object.freeze(recommendedAgents({ modules: [...impacted], contracts, risks }))
  });
}

export function testPlan({ query = "", changedModules = [], changedFiles = [] } = {}, knowledge = loadKnowledge()) {
  let modules = [...new Set((changedModules ?? []).filter((id) => knowledge.moduleById.has(id)))];
  let risks = riskTagsForText(knowledge, `${query} ${(changedFiles ?? []).join(" ")}`);
  if (modules.length === 0 && query) {
    const resolved = resolveTask(query, knowledge);
    modules = resolved.modules.map((module) => module.id);
    risks = [...new Set([...risks, ...resolved.risks])];
  }
  if (changedFiles?.length) {
    modules = [...new Set([...modules, ...detectModulesFromFiles(knowledge, changedFiles)])];
  }

  const categories = new Set(knowledge.testMatrix.defaults?.validation ?? ["build"]);
  const notes = [];
  for (const moduleId of modules) {
    const modulePlan = knowledge.testMatrix.modules?.[moduleId];
    for (const category of modulePlan?.validation ?? []) categories.add(category);
    if (modulePlan?.notes) notes.push(`${moduleId}: ${modulePlan.notes}`);
  }
  for (const rule of knowledge.testMatrix.riskRules ?? []) {
    if (!(rule.tags ?? []).some((tag) => risks.includes(tag))) continue;
    for (const category of rule.validation ?? []) categories.add(category);
  }

  return Object.freeze({
    modules: Object.freeze(modules),
    risks: Object.freeze(risks),
    validationCategories: Object.freeze([...categories]),
    notes: Object.freeze(notes)
  });
}

function gitOutput(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function localeCoverage(repoPath, locale) {
  const assetsRoot = path.join(repoPath, "src", "main", "resources", "assets");
  const englishFiles = [];
  const pending = [assetsRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name === "en_us.json" && path.basename(path.dirname(entryPath)) === "lang") {
        englishFiles.push(entryPath);
      }
    }
  }

  let presentFiles = 0;
  let validFiles = 0;
  let sourceKeys = 0;
  let translatedKeys = 0;
  for (const englishFile of englishFiles) {
    let source;
    try {
      source = readJson(englishFile);
    } catch {
      continue;
    }
    if (source == null || Array.isArray(source) || typeof source !== "object") continue;
    const targetFile = path.join(path.dirname(englishFile), `${locale}.json`);
    let target = null;
    if (fs.existsSync(targetFile)) {
      presentFiles += 1;
      try {
        target = readJson(targetFile);
        if (target != null && !Array.isArray(target) && typeof target === "object") validFiles += 1;
      } catch {
        target = null;
      }
    }
    for (const key of Object.keys(source)) {
      sourceKeys += 1;
      if (target != null && typeof target[key] === "string") translatedKeys += 1;
    }
  }

  const applicable = englishFiles.length > 0;
  return Object.freeze({
    applicable,
    sourceFiles: englishFiles.length,
    presentFiles,
    validFiles,
    sourceKeys,
    translatedKeys,
    missingKeys: sourceKeys - translatedKeys,
    complete: applicable && presentFiles === englishFiles.length && validFiles === englishFiles.length && translatedKeys === sourceKeys
  });
}

export function workspaceStatus({ knowledge = loadKnowledge(), reposRoot = defaultReposRoot(knowledge.root) } = {}) {
  return Object.freeze(knowledge.modules.map((module) => {
    const repoPath = path.join(reposRoot, module.repoName);
    if (!fs.existsSync(repoPath)) {
      return Object.freeze({
        id: module.id,
        repoName: module.repoName,
        present: false,
        locales: Object.freeze({ ja_jp: localeCoverage(repoPath, "ja_jp") }),
        expectedCommit: module.commit,
        expectedBranch: module.defaultBranch
      });
    }
    const head = gitOutput(repoPath, ["rev-parse", "HEAD"]);
    const branch = gitOutput(repoPath, ["branch", "--show-current"]);
    const status = gitOutput(repoPath, ["status", "--porcelain=v1"]);
    return Object.freeze({
      id: module.id,
      repoName: module.repoName,
      path: repoPath,
      present: true,
      locales: Object.freeze({ ja_jp: localeCoverage(repoPath, "ja_jp") }),
      head,
      branch,
      dirty: Boolean(status),
      snapshotMatch: head === module.commit,
      expectedCommit: module.commit,
      expectedBranch: module.defaultBranch
    });
  }));
}

export function knowledgeSummary(knowledge = loadKnowledge()) {
  return Object.freeze({
    snapshot: knowledge.snapshot,
    moduleCount: knowledge.modules.length,
    featureCount: knowledge.features.length,
    contractCount: knowledge.contracts.length,
    moduleIds: Object.freeze(knowledge.modules.map((module) => module.id))
  });
}
