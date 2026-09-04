import {
  impactAnalysis,
  loadKnowledge,
  resolveTask,
  testPlan
} from "./workspace-knowledge.mjs";

const SCHEMA_VERSION = 1;
const MAX_SUBAGENTS = 4;
const CRITICAL_CONTRACT_TYPES = new Set([
  "hard-core",
  "runtime-optional",
  "observer-provider",
  "eventbus"
]);
const HIGH_RISK_TAGS = new Set([
  "shared-contract",
  "client-server",
  "observer",
  "fabric-compat",
  "privacy",
  "privacy-redaction"
]);

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function moduleIdsFromResolution(resolved) {
  return unique((resolved?.modules ?? []).map((entry) => entry.id));
}

function selectedContracts(knowledge, moduleIds, resolvedContracts) {
  const moduleSet = new Set(moduleIds);
  const resolvedIds = new Set((resolvedContracts ?? []).map((entry) => entry.id));
  return knowledge.contracts.filter((contract) => {
    if (resolvedIds.has(contract.id)) return true;
    const endpoints = unique([contract.from, contract.to, ...(contract.relatedNodes ?? [])]);
    return endpoints.filter((id) => moduleSet.has(id)).length >= 2;
  });
}

function scoreFactors({
  knowledge,
  modules,
  contracts,
  risks,
  validationCategories,
  resolution
}) {
  const defaultValidationCount = new Set(knowledge.testMatrix?.defaults?.validation ?? []).size;
  const criticalContracts = contracts.filter((contract) => CRITICAL_CONTRACT_TYPES.has(contract.type));
  const highRisks = risks.filter((risk) => HIGH_RISK_TAGS.has(risk));
  const inferredModules = (resolution?.modules ?? []).filter((entry) => Number(entry.score ?? 0) <= 0).length;

  const factors = Object.freeze({
    moduleSpan: clamp(Math.max(0, modules.length - 1) * 2, 0, 6),
    contractSurface: clamp(contracts.length, 0, 3),
    criticalContracts: clamp(criticalContracts.length, 0, 3),
    coreSurface: modules.includes("totem-core") ? 2 : 0,
    riskBreadth: clamp(risks.length, 0, 3),
    highRisk: highRisks.length ? 2 : 0,
    verificationBreadth: clamp(
      Math.max(0, new Set(validationCategories).size - defaultValidationCount),
      0,
      3
    ),
    routingUncertainty: inferredModules > 1 ? 1 : 0
  });

  return Object.freeze({
    factors,
    total: Object.values(factors).reduce((sum, value) => sum + value, 0),
    criticalContractIds: Object.freeze(criticalContracts.map((contract) => contract.id)),
    highRisks: Object.freeze(highRisks)
  });
}

function modeForScore(score) {
  if (score <= 2) return "primary-only";
  if (score <= 5) return "assisted";
  if (score <= 9) return "bounded-parallel";
  return "guarded-parallel";
}

function assignment({
  id,
  role,
  purpose,
  modules = [],
  phase,
  dependsOn = [],
  writeAllowed = false,
  contextAudience,
  maxContextTokens,
  deliverable
}) {
  return Object.freeze({
    id,
    role,
    purpose,
    modules: Object.freeze(unique(modules)),
    phase,
    dependsOn: Object.freeze(unique(dependsOn)),
    writeAllowed,
    contextAudience,
    maxContextTokens,
    deliverable
  });
}

function chooseWorkerModules(modules, resolution, maxWorkers = 2) {
  const scores = new Map((resolution?.modules ?? []).map((entry) => [entry.id, Number(entry.score ?? 0)]));
  return [...modules]
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, maxWorkers);
}

function buildAssignments({
  mode,
  modules,
  contracts,
  risks,
  resolution,
  requiresIndependentReview,
  validationCategories
}) {
  if (mode === "primary-only") return Object.freeze([]);

  const assignments = [];
  const criticalArchitecture = modules.includes("totem-core")
    || contracts.some((contract) => CRITICAL_CONTRACT_TYPES.has(contract.type))
    || risks.some((risk) => HIGH_RISK_TAGS.has(risk));

  const discoveryModules = modules.slice(0, 4);
  const workerModules = chooseWorkerModules(modules, resolution, 2);

  if (mode === "assisted") {
    if (criticalArchitecture) {
      assignments.push(assignment({
        id: "architect:contracts",
        role: "architect",
        purpose: "Stabilize ownership, shared contracts, protocol boundaries, and ordering constraints before edits.",
        modules: discoveryModules,
        phase: "discovery",
        writeAllowed: false,
        contextAudience: "architect",
        maxContextTokens: 7000,
        deliverable: "Contract/ownership decision, risk notes, and explicit worker boundaries."
      }));
    } else {
      assignments.push(assignment({
        id: "explorer:scope",
        role: "explorer",
        purpose: "Confirm the smallest relevant code surface and concrete implementation locations.",
        modules: discoveryModules,
        phase: "discovery",
        writeAllowed: false,
        contextAudience: "explorer",
        maxContextTokens: 6000,
        deliverable: "Bounded file/symbol map and unresolved questions."
      }));
    }

    if (requiresIndependentReview && assignments.length < MAX_SUBAGENTS) {
      assignments.push(assignment({
        id: "reviewer:integration",
        role: "reviewer",
        purpose: "Independently review the Primary implementation against cross-module contracts and required verification.",
        modules: discoveryModules,
        phase: "review",
        dependsOn: assignments.map((entry) => entry.id),
        writeAllowed: false,
        contextAudience: "reviewer",
        maxContextTokens: 7000,
        deliverable: "Findings ordered by severity plus validation gaps."
      }));
    }
    return Object.freeze(assignments);
  }

  if (mode === "guarded-parallel" && criticalArchitecture) {
    assignments.push(assignment({
      id: "architect:contracts",
      role: "architect",
      purpose: "Freeze contract/API/protocol decisions before parallel implementation starts.",
      modules: discoveryModules,
      phase: "discovery",
      writeAllowed: false,
      contextAudience: "architect",
      maxContextTokens: 8000,
      deliverable: "Stable contract decision and module-by-module implementation constraints."
    }));
  } else {
    assignments.push(assignment({
      id: "explorer:scope",
      role: "explorer",
      purpose: "Map relevant implementations and confirm that proposed module splits do not overlap.",
      modules: discoveryModules,
      phase: "discovery",
      writeAllowed: false,
      contextAudience: "explorer",
      maxContextTokens: 6500,
      deliverable: "File/symbol ownership map and safe parallelization boundaries."
    }));
  }

  const discoveryIds = assignments.map((entry) => entry.id);
  for (const moduleId of workerModules) {
    if (assignments.length >= MAX_SUBAGENTS - 1) break;
    assignments.push(assignment({
      id: `worker:${moduleId}`,
      role: "worker",
      purpose: `Implement only the bounded ${moduleId} portion of the task after discovery/contract constraints are stable.`,
      modules: [moduleId],
      phase: "implementation",
      dependsOn: discoveryIds,
      writeAllowed: true,
      contextAudience: "worker",
      maxContextTokens: 9000,
      deliverable: "Module-local implementation, changed-file list, and module-local verification result."
    }));
  }

  if (assignments.length < MAX_SUBAGENTS) {
    assignments.push(assignment({
      id: "reviewer:integration",
      role: "reviewer",
      purpose: "Review integrated changes independently after workers/Primary complete, with emphasis on contracts, regressions, and required tests.",
      modules: discoveryModules,
      phase: "review",
      dependsOn: assignments.filter((entry) => entry.role === "worker").map((entry) => entry.id),
      writeAllowed: false,
      contextAudience: "reviewer",
      maxContextTokens: 8000,
      deliverable: `Independent findings and confirmation of verification coverage: ${validationCategories.join(", ") || "default build"}.`
    }));
  }

  return Object.freeze(assignments);
}

function executionWaves(assignments) {
  const discovery = assignments.filter((entry) => entry.phase === "discovery").map((entry) => entry.id);
  const implementation = assignments.filter((entry) => entry.phase === "implementation").map((entry) => entry.id);
  const review = assignments.filter((entry) => entry.phase === "review").map((entry) => entry.id);
  return Object.freeze([
    ...(discovery.length ? [Object.freeze({ phase: "discovery", parallel: true, assignments: Object.freeze(discovery) })] : []),
    ...(implementation.length ? [Object.freeze({ phase: "implementation", parallel: implementation.length > 1, assignments: Object.freeze(implementation) })] : []),
    ...(review.length ? [Object.freeze({ phase: "review", parallel: false, assignments: Object.freeze(review) })] : [])
  ]);
}

export function buildOrchestrationPlan({
  query,
  moduleId = null,
  featureId = null,
  changedModules = [],
  changedFiles = [],
  knowledge = loadKnowledge()
} = {}) {
  if (typeof query !== "string" || !query.trim()) throw new Error("orchestration plan requires a query");

  const resolved = resolveTask(query, knowledge);
  const modules = new Set(moduleIdsFromResolution(resolved));
  if (moduleId && knowledge.moduleById.has(moduleId)) modules.add(moduleId);
  if (featureId && knowledge.featureById.has(featureId)) modules.add(knowledge.featureById.get(featureId).ownerId);
  for (const id of changedModules ?? []) {
    if (knowledge.moduleById.has(id)) modules.add(id);
  }

  let impact = null;
  if ((changedModules?.length ?? 0) || (changedFiles?.length ?? 0)) {
    try {
      impact = impactAnalysis({ changedModules, changedFiles }, knowledge);
      for (const id of impact.impactedModules) modules.add(id);
    } catch {
      impact = null;
    }
  }

  const moduleList = [...modules].slice(0, 7);
  const contracts = selectedContracts(knowledge, moduleList, resolved.contracts);
  const verification = testPlan({
    query,
    changedModules: unique([...moduleList, ...(changedModules ?? [])]),
    changedFiles
  }, knowledge);
  const risks = unique([...(resolved.risks ?? []), ...(impact?.risks ?? []), ...(verification.risks ?? [])]);
  const scoring = scoreFactors({
    knowledge,
    modules: moduleList,
    contracts,
    risks,
    validationCategories: verification.validationCategories,
    resolution: resolved
  });
  const mode = modeForScore(scoring.total);
  const requiresIndependentReview = Boolean(
    impact?.requiresIndependentReview
    || moduleList.length > 1
    || contracts.length > 0
    || scoring.total >= 6
  );
  const assignments = buildAssignments({
    mode,
    modules: moduleList,
    contracts,
    risks,
    resolution: resolved,
    requiresIndependentReview,
    validationCategories: verification.validationCategories
  });
  const workers = assignments.filter((entry) => entry.role === "worker");

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    query,
    mode,
    score: scoring.total,
    scoreFactors: scoring.factors,
    rationale: Object.freeze({
      modules: Object.freeze(moduleList),
      contractIds: Object.freeze(contracts.map((contract) => contract.id)),
      criticalContractIds: scoring.criticalContractIds,
      risks: Object.freeze(risks),
      highRisks: scoring.highRisks,
      validationCategories: verification.validationCategories,
      requiresIndependentReview
    }),
    coordinator: Object.freeze({
      role: "primary",
      responsibility: "Own the user goal, merge agent outputs, resolve conflicts, run final impact/test planning, and deliver the final result."
    }),
    assignments,
    executionWaves: executionWaves(assignments),
    limits: Object.freeze({
      maxSubagents: MAX_SUBAGENTS,
      recommendedSubagents: assignments.length,
      maxParallelWorkers: Math.min(2, workers.length),
      duplicateRepositoryReads: "avoid",
      workerWriteScope: "module-bounded"
    }),
    fallback: Object.freeze({
      whenMultiAgentUnavailable: "Execute the same assignments sequentially in the Primary agent while preserving read/write boundaries and independent review intent.",
      smallTaskRule: "primary-only plans must not spawn subagents."
    }),
    estimatedBenefit: moduleList.length >= 3 || workers.length > 1
      ? "high"
      : assignments.length >= 2
        ? "medium"
        : assignments.length === 1
          ? "low"
          : "none"
  });
}

export function orchestrationPlanSummary(plan) {
  const roles = plan.assignments.map((entry) => entry.role);
  return Object.freeze({
    mode: plan.mode,
    score: plan.score,
    modules: plan.rationale.modules,
    subagents: plan.assignments.length,
    roles: Object.freeze(roles),
    maxParallelWorkers: plan.limits.maxParallelWorkers,
    estimatedBenefit: plan.estimatedBenefit
  });
}
