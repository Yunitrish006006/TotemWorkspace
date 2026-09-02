import { loadKnowledge, resolveTask, testPlan } from "./workspace-knowledge.mjs";
import { searchCode } from "./code-index.mjs";

function compactModule(module) {
  return {
    id: module.id,
    name: module.name,
    version: module.version,
    branch: module.defaultBranch,
    commit: module.commit,
    role: module.role,
    coreDependency: module.coreDependency,
    featureGroups: module.featureGroups
  };
}

function compactFeature(feature) {
  return {
    id: feature.id,
    ownerId: feature.ownerId,
    title: feature.title,
    summary: feature.summary,
    softContractIds: feature.softContractIds,
    serviceContractIds: feature.serviceContractIds,
    eventContractIds: feature.eventContractIds
  };
}

function compactContract(contract) {
  return {
    id: contract.id,
    type: contract.type,
    from: contract.from,
    to: contract.to,
    relatedNodes: contract.relatedNodes,
    feature: contract.feature,
    fallback: contract.fallback,
    featureIds: contract.featureIds,
    family: contract.family,
    protocol: contract.protocol,
    variants: contract.variants
  };
}

function pruneCodeResults(results, audience) {
  const maxPreview = audience === "primary" ? 700 : audience === "reviewer" ? 1100 : 1800;
  return results.map((result) => ({
    ...result,
    preview: result.preview.slice(0, maxPreview)
  }));
}

function clampByApproxTokens(value, maxTokens) {
  const maxChars = Math.max(2_000, Math.min(Number(maxTokens) || 8_000, 40_000) * 4);
  let text = JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return { text, truncated: false };

  const clone = structuredClone(value);
  if (Array.isArray(clone.codeResults)) {
    while (clone.codeResults.length > 1 && JSON.stringify(clone).length > maxChars) clone.codeResults.pop();
  }
  if (Array.isArray(clone.features)) {
    while (clone.features.length > 3 && JSON.stringify(clone).length > maxChars) clone.features.pop();
  }
  if (Array.isArray(clone.contracts)) {
    while (clone.contracts.length > 3 && JSON.stringify(clone).length > maxChars) clone.contracts.pop();
  }
  text = JSON.stringify(clone, null, 2);
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 80)}\n... context pack truncated ...`;
  return { text, truncated: true };
}

export function buildContextPack(query, { audience = "primary", moduleId = null, maxTokens = 8_000, includeCode = true, knowledge = loadKnowledge() } = {}) {
  const resolved = resolveTask(query, knowledge);
  const selectedModuleIds = moduleId
    ? [moduleId]
    : resolved.modules.map((module) => module.id);
  const moduleSet = new Set(selectedModuleIds);

  const modules = knowledge.modules.filter((module) => moduleSet.has(module.id)).map(compactModule);
  const features = resolved.features
    .filter((feature) => moduleSet.has(feature.ownerId))
    .map(compactFeature);
  const contracts = resolved.contracts
    .filter((contract) => [contract.from, contract.to, ...(contract.relatedNodes ?? [])].some((node) => moduleSet.has(node)))
    .map(compactContract);
  const plan = testPlan({ query, changedModules: selectedModuleIds }, knowledge);

  const code = includeCode
    ? searchCode(query, {
      knowledge,
      modules: selectedModuleIds,
      limit: audience === "primary" ? 6 : audience === "reviewer" ? 10 : 16
    })
    : { indexed: false, results: [] };

  const pack = {
    schemaVersion: 1,
    audience,
    query,
    snapshot: knowledge.snapshot,
    routing: {
      modules: selectedModuleIds,
      risks: resolved.risks,
      recommendedAgents: resolved.recommendedAgents
    },
    modules,
    features,
    contracts,
    validation: plan,
    codeIndex: {
      indexed: code.indexed,
      generatedAt: code.generatedAt ?? null,
      message: code.message ?? null
    },
    codeResults: pruneCodeResults(code.results ?? [], audience),
    operatingRules: [
      "Use live repository source for implementation details when it differs from the TotemWorkspace snapshot.",
      "Use TotemWorkspace graph/contracts as the cross-module architecture source of truth.",
      "Do not broaden repository-wide reads before using this narrowed context unless evidence requires it.",
      "For shared contract changes, stabilize the contract before parallel module implementation.",
      "After edits, run impact analysis and the returned validation categories."
    ]
  };

  const rendered = clampByApproxTokens(pack, maxTokens);
  return Object.freeze({
    ...pack,
    rendered: rendered.text,
    truncated: rendered.truncated
  });
}
