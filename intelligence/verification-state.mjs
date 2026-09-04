import fs from "node:fs";
import path from "node:path";
import { activeVerificationPlan } from "./verification-graph.mjs";

const TEST_EVENT_STATUS = Object.freeze({
  test_started: "running",
  test_passed: "passed",
  test_failed: "failed"
});

function statePath(workspaceRoot) {
  return path.join(workspaceRoot, ".totem-index", "verification-state.json");
}

function stateKey(event) {
  return `${event.moduleId ?? ""}\0${event.test ?? ""}`;
}

function emptyState() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    entries: []
  };
}

export function loadVerificationState(workspaceRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(workspaceRoot), "utf8"));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries)) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

function saveVerificationState(workspaceRoot, state) {
  const filePath = statePath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
  return state;
}

export function recordVerificationEvent(workspaceRoot, event) {
  const status = TEST_EVENT_STATUS[event?.type];
  const target = String(event?.test ?? "").trim();
  if (!status || !target) return null;

  const current = loadVerificationState(workspaceRoot);
  const key = stateKey(event);
  const nextEntry = {
    key,
    target,
    moduleId: event.moduleId ?? null,
    status,
    sequence: event.sequence ?? 0,
    timestamp: event.timestamp ?? new Date().toISOString(),
    summary: event.summary ?? null
  };

  const entries = current.entries.filter((entry) => entry.key !== key);
  entries.push(nextEntry);
  entries.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || String(a.key).localeCompare(String(b.key)));

  return saveVerificationState(workspaceRoot, {
    schemaVersion: 1,
    updatedAt: nextEntry.timestamp,
    entries
  });
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function resolveTest(entry, verification) {
  const tests = verification?.tests ?? [];
  const target = String(entry.target ?? "");
  const moduleTests = entry.moduleId
    ? tests.filter((test) => test.moduleId === entry.moduleId)
    : tests;

  const exact = tests.find((test) => test.id === target);
  if (exact) return exact;

  const normalized = normalizePath(target);
  const byPath = moduleTests.filter((test) => normalizePath(test.path) === normalized);
  if (byPath.length === 1) return byPath[0];

  const basename = path.posix.basename(normalized).toLowerCase();
  if (basename) {
    const byBasename = moduleTests.filter((test) => path.posix.basename(test.path).toLowerCase() === basename);
    if (byBasename.length === 1) return byBasename[0];
  }

  const byLabel = moduleTests.filter((test) => String(test.label).toLowerCase() === target.toLowerCase());
  if (byLabel.length === 1) return byLabel[0];
  return null;
}

function semanticTargets(test) {
  if (!test) return [];
  return [
    test.id,
    test.moduleId,
    ...(test.featureIds ?? []),
    ...(test.componentIds ?? []),
    ...(test.contractIds ?? []),
    ...(test.capabilityIds ?? [])
  ].filter(Boolean);
}

export function verificationStatePayloadFromState({
  state,
  knowledge,
  verification,
  changeIntelligence = null
} = {}) {
  const safeState = state?.schemaVersion === 1 && Array.isArray(state.entries) ? state : emptyState();
  const entries = safeState.entries.map((entry) => {
    const test = resolveTest(entry, verification);
    return Object.freeze({
      target: entry.target,
      status: entry.status,
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      summary: entry.summary ?? null,
      resolved: Boolean(test),
      testId: test?.id ?? null,
      moduleId: test?.moduleId ?? entry.moduleId ?? null,
      featureIds: Object.freeze([...(test?.featureIds ?? [])]),
      componentIds: Object.freeze([...(test?.componentIds ?? [])]),
      contractIds: Object.freeze([...(test?.contractIds ?? [])]),
      capabilityIds: Object.freeze([...(test?.capabilityIds ?? [])])
    });
  });

  const targetsByStatus = {
    running: new Set(),
    passed: new Set(),
    failed: new Set()
  };
  for (const entry of safeState.entries) {
    const test = resolveTest(entry, verification);
    if (!targetsByStatus[entry.status]) continue;
    for (const target of semanticTargets(test)) targetsByStatus[entry.status].add(target);
    if (!test && entry.moduleId) targetsByStatus[entry.status].add(entry.moduleId);
  }

  const counts = { running: 0, passed: 0, failed: 0, unresolved: 0 };
  for (const entry of entries) {
    if (entry.status in counts) counts[entry.status] += 1;
    if (!entry.resolved) counts.unresolved += 1;
  }

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    updatedAt: safeState.updatedAt,
    entries: Object.freeze(entries),
    summary: Object.freeze(counts),
    runningTargetIds: Object.freeze([...targetsByStatus.running].sort()),
    passedTargetIds: Object.freeze([...targetsByStatus.passed].sort()),
    failedTargetIds: Object.freeze([...targetsByStatus.failed].sort()),
    activePlan: activeVerificationPlan({ knowledge, changeIntelligence })
  });
}

export function verificationStatePayload({
  workspaceRoot,
  knowledge,
  verification,
  changeIntelligence = null
} = {}) {
  return verificationStatePayloadFromState({
    state: loadVerificationState(workspaceRoot),
    knowledge,
    verification,
    changeIntelligence
  });
}
