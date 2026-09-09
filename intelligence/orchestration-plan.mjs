import { impactAnalysis, loadKnowledge, resolveTask, testPlan } from "./workspace-knowledge.mjs";

const unique = (values) => [...new Set((values ?? []).filter(Boolean))].sort();
const criticalTypes = new Set(["hard-core", "runtime-optional", "observer-provider", "eventbus"]);
const highRiskTags = new Set(["shared-contract", "client-server", "observer", "fabric-compat", "privacy", "privacy-redaction", "persistence", "networking", "security"]);

export const EXECUTION_OPTIMIZATION = Object.freeze({
  primaryGoal: "correctness",
  secondaryGoal: "minimize-total-model-tokens",
  latencyPriority: "low",
  preferLightweightModels: true,
  avoidDuplicateContext: true,
  preferSequentialWhenCheaper: true
});

// This is a work contract. The executor chooses its internal agent topology.
export function buildOrchestrationPlan({ query, moduleId = null, featureId = null, changedModules = [], changedFiles = [], knowledge = loadKnowledge() } = {}) {
  if (typeof query !== "string" || !query.trim()) throw new Error("orchestration plan requires a query");
  const resolved = resolveTask(query, knowledge);
  const valid = (id) => id === "totem-workspace" || knowledge.moduleById.has(id);
  // A sibling starting directory is transport context, not an extra game-module write target for tooling work.
  const focus = resolved.modules.some((entry) => entry.id === "totem-workspace")
    ? "totem-workspace"
    : featureId ? knowledge.featureById.get(featureId)?.ownerId : moduleId;
  const writeModules = unique([
    ...resolved.modules.map((entry) => entry.id),
    ...(valid(focus) ? [focus] : []),
    ...changedModules.filter(valid)
  ]);
  let impact = null;
  if (writeModules.length || changedFiles.length) impact = impactAnalysis({ changedModules: writeModules, changedFiles }, knowledge);
  for (const id of impact?.touchedModules ?? []) if (!writeModules.includes(id)) writeModules.push(id);
  writeModules.sort();
  const affectedModules = unique([...writeModules, ...(impact?.impactedModules ?? [])]);
  const contracts = unique([...(resolved.contracts ?? []).map((entry) => entry.id), ...(impact?.contracts ?? []).map((entry) => entry.id)])
    .map((id) => knowledge.contractById.get(id)).filter(Boolean);
  const requiredValidation = testPlan({ query, changedModules: affectedModules, changedFiles }, knowledge);
  const sharedChangeIntent = writeModules.includes("totem-core") || writeModules.length > 1
    || /shared|contract|\bapi\b|protocol|observer|persistence|network|共享|協議|契約/i.test(query);
  const risks = unique([...resolved.risks, ...(sharedChangeIntent ? impact?.risks ?? [] : []), ...requiredValidation.risks,
    ...(/persist|storage|database|network|protocol|security|credential/i.test(query) ? ["high-risk-behavior"] : [])]);
  const critical = contracts.filter((entry) => criticalTypes.has(entry.type));
  const highRisks = risks.filter((risk) => highRiskTags.has(risk) || risk === "high-risk-behavior");
  const sharedContractStabilizationRequired = (critical.length > 0 && sharedChangeIntent) || writeModules.includes("totem-core");
  const independentReviewRequired = writeModules.length > 1 || sharedContractStabilizationRequired || highRisks.length > 0
    || /refactor|runtime|orchestration|重構/i.test(query);
  const maxConcurrentWrites = sharedContractStabilizationRequired || highRisks.length ? 1 : Math.max(1, Math.min(2, writeModules.length));
  const ownerModules = unique(critical.map((contract) => contract.type === "hard-core" ? contract.to : contract.providerOwner ?? contract.from)
    .filter((id) => writeModules.includes(id)));
  if (writeModules.includes("totem-core") && !ownerModules.includes("totem-core")) ownerModules.unshift("totem-core");
  const wave = (id, modules, writeAllowed, dependsOn, goals, modelHint = "lightweight-preferred") => ({
    id, phase: id, modules, writeAllowed, dependsOn, goals, required: true,
    parallelizable: !writeAllowed || (maxConcurrentWrites > 1 && modules.length > 1),
    maxConcurrentWrites: writeAllowed ? maxConcurrentWrites : 0,
    modelHint, contextBudget: modelHint === "strong-reasoning-preferred" ? 12000 : 6000,
    parallelismBenefit: writeAllowed && maxConcurrentWrites > 1 ? "conditional-on-low-context-duplication" : "low"
  });
  const waves = [wave("discovery", affectedModules, false, [], ["Locate implementation, consumers, symbols and tests once; retain compact evidence."])];
  if (sharedContractStabilizationRequired) waves.push(wave("shared-contract", ownerModules, ownerModules.length > 0, ["discovery"],
    ["Inspect all impacted consumers and stabilize API/protocol decisions before consumer writes."], "strong-reasoning-preferred"));
  const implementationModules = sharedContractStabilizationRequired ? writeModules.filter((id) => !ownerModules.includes(id)) : writeModules;
  if (implementationModules.length) waves.push(wave(sharedContractStabilizationRequired ? "consumer-update" : "implementation", implementationModules, true,
    [sharedContractStabilizationRequired ? "shared-contract" : "discovery"], ["Implement within module write boundaries; reuse upstream evidence."], highRisks.length ? "strong-reasoning-preferred" : "lightweight-preferred"));
  waves.push(wave("verification", affectedModules, false, [waves.at(-1).id],
    ["Run impact, obtain test_plan, inspect impacted consumers and execute actual required deterministic validation."]));
  if (independentReviewRequired) waves.push(wave("independent-review", affectedModules, false, ["verification"],
    ["Obtain an actually independent review and record evidence; the executor chooses the mechanism."], highRisks.length ? "strong-reasoning-preferred" : "lightweight-preferred"));
  const scope = (ids) => ids.map((id) => ({ moduleId: id, paths: [`${id === "totem-workspace" ? "TotemWorkspace" : knowledge.moduleById.get(id)?.repoName ?? id}/**`] }));
  const scoreFactors = { moduleSpan: Math.max(0, affectedModules.length - 1) * 2, contractSurface: contracts.length, highRisk: highRisks.length * 2 };
  return Object.freeze({
    schemaVersion: 2, query: query.trim().replace(/\s+/g, " "),
    affectedModules, affectedFeatures: unique(resolved.features.map((feature) => feature.id)),
    affectedComponents: resolved.components ?? [], contracts, readScope: scope(affectedModules), writeScope: scope(writeModules),
    impactedConsumers: affectedModules.filter((id) => !ownerModules.includes(id) && (!writeModules.includes(id) || sharedContractStabilizationRequired)),
    execution: { parallelismAllowed: true, maxConcurrentWrites, sharedContractStabilizationRequired, moduleOwnershipRequired: true, overlappingWritesAllowed: false },
    dependencyOrdering: waves.flatMap((entry) => entry.dependsOn.map((dependency) => ({ before: dependency, after: entry.id }))),
    waves, executionWaves: waves, parallelizableWork: waves.filter((entry) => entry.parallelizable).map((entry) => entry.id),
    independentReviewRequired, requiredValidation,
    riskConstraints: risks,
    releaseConstraints: ["Validation is not release authorization.", "Commit/push only when authorized; publish only with explicit authorization; verify CI and Modrinth read-back."],
    securityConstraints: ["Preserve secrets/privacy redaction and approval boundaries.", "Preserve Observer owner-provided production rendering, monotonic semantic snapshots, input suppression and framebuffer-free reconstruction."],
    engineeringConstraints: ["Java 25 and repository Gradle wrapper; inspect configured Minecraft, Fabric Loader/API and mappings.", "Preserve dedicated-server safety and client-only class isolation; inspect shared API consumers before edits.", "Keep feature-specific behavior in its owning module; required validation cannot be waived for token savings."],
    optimization: EXECUTION_OPTIMIZATION,
    contextHints: { budget: 8000, reuseEvidence: true, evidenceFields: ["modules", "contracts", "files", "symbols", "tests", "findings", "unresolvedQuestions"], modelPreference: highRisks.length || sharedContractStabilizationRequired ? "strong-reasoning-preferred" : "lightweight-preferred", escalationAllowed: true,
      escalationTriggers: ["architecture judgment", "conflicting contracts or evidence", "high-risk persistence/networking", "non-local validation failure", "insufficient correctness confidence", "retries cost more tokens than escalation"],
      strategy: "Use the cheapest capable available model for bounded work. Reuse compact evidence before delegation or escalation; prefer sequential execution when it avoids duplicate context. No fixed agent topology is required." },
    score: Object.values(scoreFactors).reduce((sum, value) => sum + value, 0), scoreFactors,
    rationale: { modules: affectedModules, contractIds: contracts.map((entry) => entry.id), criticalContractIds: critical.map((entry) => entry.id), risks, highRisks, validationCategories: requiredValidation.validationCategories, requiresIndependentReview: independentReviewRequired }
  });
}

export function orchestrationPlanSummary(plan) {
  return Object.freeze({ schemaVersion: plan.schemaVersion, score: plan.score, modules: plan.affectedModules,
    execution: plan.execution, waves: plan.waves, independentReviewRequired: plan.independentReviewRequired,
    requiredValidation: plan.requiredValidation, optimization: plan.optimization, contextHints: plan.contextHints });
}
