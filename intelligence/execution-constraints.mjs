import fs from "node:fs";
import path from "node:path";

const states = new WeakMap();
const data = (state) => {
  const value = states.get(state);
  if (!value) throw new Error("Unknown execution constraint state");
  return value;
};
function canonical(target) {
  if (fs.existsSync(target)) return fs.realpathSync(target);
  const parent = path.dirname(target);
  return parent === target ? target : path.join(canonical(parent), path.basename(target));
}
function ready(value, waveId) {
  const wave = value.plan.waves.find((entry) => entry.id === waveId);
  if (!wave) throw new Error(`Unknown wave: ${waveId}`);
  if (value.completed.has(waveId)) throw new Error(`Wave already complete: ${waveId}`);
  if (wave.dependsOn.some((id) => !value.completed.has(id))) throw new Error(`Wave dependencies incomplete: ${waveId}`);
  return wave;
}
export function createExecutionState(plan, { reposRoot = process.cwd() } = {}) {
  if (plan?.schemaVersion !== 2 || !Array.isArray(plan.waves)) throw new Error("Execution constraints require schema v2");
  const state = Object.freeze({ schemaVersion: 2 });
  states.set(state, { plan: structuredClone(plan), reposRoot: canonical(path.resolve(reposRoot)), completed: new Map(), leases: new Map() });
  return state;
}
export function executionSnapshot(state) {
  const value = data(state);
  return { completedWaves: [...value.completed.keys()], activeWrites: [...value.leases.values()].map((lease) => ({ ...lease })),
    complete: value.plan.waves.filter((wave) => wave.required).every((wave) => value.completed.has(wave.id)) };
}
export function acquireWrite(state, { moduleId, path: file, waveId, leaseId }) {
  const value = data(state);
  const wave = ready(value, waveId);
  if (!wave.writeAllowed || !wave.modules.includes(moduleId)) throw new Error("Write is outside wave/module ownership");
  if (typeof file !== "string" || !file || file.split(/[\\/]/).includes("..")) throw new Error("Invalid write path");
  const scope = value.plan.writeScope.find((entry) => entry.moduleId === moduleId);
  const target = canonical(path.resolve(value.reposRoot, file));
  const allowed = scope?.paths.some((pattern) => {
    const root = canonical(path.resolve(value.reposRoot, pattern.replace(/\/\*\*$/, "")));
    const relative = path.relative(root, target);
    return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
  if (!allowed) throw new Error("Write path is outside declared write scope");
  if (!leaseId || value.leases.has(leaseId)) throw new Error("A unique write lease is required");
  if (value.leases.size >= Math.min(value.plan.execution.maxConcurrentWrites, wave.maxConcurrentWrites)) throw new Error("Maximum concurrent writes exceeded");
  if ([...value.leases.values()].some((lease) => lease.moduleId === moduleId || lease.path === target)) throw new Error("Overlapping module write ownership");
  const lease = Object.freeze({ leaseId, moduleId, path: target, waveId });
  value.leases.set(leaseId, lease);
  return lease;
}
export function releaseWrite(state, leaseId) {
  if (!data(state).leases.delete(leaseId)) throw new Error("Unknown write lease");
}
export function completeWave(state, waveId, evidence = {}) {
  const value = data(state);
  const wave = ready(value, waveId);
  if ([...value.leases.values()].some((lease) => lease.waveId === waveId)) throw new Error("Release active writes before completing a wave");
  if (!evidence.reference || typeof evidence.reference !== "string") throw new Error("Wave completion requires evidence reference");
  if (waveId === "shared-contract" && evidence.stabilized !== true) throw new Error("Shared-contract stabilization evidence required");
  if (waveId === "verification") {
    if (!evidence.impact || !evidence.testPlan || !evidence.consumerInspection) throw new Error("Impact, test plan and impacted consumer inspection evidence required");
    for (const category of value.plan.requiredValidation.validationCategories) {
      const result = evidence.validations?.find((entry) => entry.category === category);
      if (!result || result.status !== "passed" || result.exitCode !== 0 || !result.command || !result.reference) throw new Error(`Actual deterministic validation evidence missing: ${category}`);
    }
  }
  if (waveId === "independent-review" && (!evidence.independent || !evidence.reviewer || !Array.isArray(evidence.implementers)
      || evidence.implementers.length === 0 || evidence.implementers.includes(evidence.reviewer))) throw new Error("Actual independent review evidence required");
  value.completed.set(wave.id, structuredClone(evidence));
  return executionSnapshot(state);
}
