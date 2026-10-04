import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildOrchestrationPlan } from './orchestration-plan.mjs';
import { resolveModelPolicy } from './model-policy.mjs';
import { probeCodexRuntime } from './codex-runtime-probe.mjs';

export const ALLOCATION_POLICY_VERSION = 'native-v1';
const MAX_RECORDS = 500;
const MAX_AGE_MS = 30 * 86400000;
const OUTCOMES = new Set(['success', 'quality-failure', 'infrastructure-failure', 'cancelled', 'quota-exhausted', 'incomplete']);
const STAGES = new Set(['discovery', 'implementation', 'verification', 'independent-review']);
const MODEL_ID = /^[a-zA-Z0-9_.:/-]{1,100}$/;
const TASK_ID = /^[a-f0-9-]{36}$/;
const tiers = ['lightweight-preferred', 'balanced-preferred', 'strong-reasoning-preferred'];

export function allocationTaskClass(query, plan) {
  if (plan.contextHints.modelPreference === 'strong-reasoning-preferred') return 'critical';
  if (!plan.writeScope.length) return 'inspection';
  if (/typo|spelling|mechanical|錯字|拼字|機械/i.test(query)) return 'mechanical';
  return 'implementation';
}

function safeDirectory(root, create = false) {
  root = fs.realpathSync(root);
  const relative = '.totem-index/native-allocation';
  try { execFileSync('git', ['check-ignore', '-q', '--', `${relative}/probe.json`], { cwd: root, stdio: 'pipe' }); }
  catch { throw new Error('Native allocation storage must be Git-ignored'); }
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      if (!create) return null;
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Native allocation storage must remain inside the repository');
  }
  return current;
}
function records(root) {
  const directory = safeDirectory(root);
  if (!directory) return [];
  const names = fs.readdirSync(directory).filter(name => TASK_ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
  return names.slice(0, MAX_RECORDS).map(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('Invalid native allocation record');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record.schemaVersion !== 1 || `${record.taskId}.json` !== name) throw new Error('Invalid native allocation record');
    return record;
  });
}
function readRecord(root, taskId) {
  if (!TASK_ID.test(taskId ?? '')) throw new Error('Invalid allocation task ID');
  const directory = safeDirectory(root);
  if (!directory) throw new Error('Unknown allocation task');
  const file = path.join(directory, `${taskId}.json`);
  if (!fs.existsSync(file)) throw new Error('Unknown allocation task');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('Invalid native allocation record');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.schemaVersion !== 1 || record.taskId !== taskId) throw new Error('Invalid native allocation record');
  return record;
}
function writeRecord(root, record, initial = false) {
  const directory = safeDirectory(root, true);
  const file = path.join(directory, `${record.taskId}.json`);
  const data = JSON.stringify(record);
  if (Buffer.byteLength(data) > 65536) throw new Error('Native allocation record exceeds bounded size');
  if (initial) { fs.writeFileSync(file, data, { flag: 'wx', mode: 0o600 }); return; }
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}
function withRecord(root, taskId, update) {
  const directory = safeDirectory(root, true);
  if (!TASK_ID.test(taskId ?? '')) throw new Error('Invalid allocation task ID');
  const lock = path.join(directory, `${taskId}.lock`);
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error('Allocation task is busy; retry after the current update'); }
  try {
    const record = readRecord(root, taskId);
    update(record);
    writeRecord(root, record);
    return record;
  } finally { fs.rmdirSync(lock); }
}

// Feedback is a claim from a native session, not authenticated runtime telemetry.
// It can suggest a more capable model, never weaken a risk floor or certify completion.
export function adaptivePreference(base, history) {
  if (!tiers.includes(base)) throw new Error('Unknown allocation risk floor');
  const eligible = history.filter(record => ['success', 'quality-failure'].includes(record.feedback?.outcome));
  const failures = eligible.filter(record => record.feedback.outcome === 'quality-failure').length;
  const promote = eligible.length >= 5 && failures >= 2;
  return { preference: tiers[Math.min(2, tiers.indexOf(base) + (promote ? 1 : 0))],
    comparableReports: eligible.length, qualityFailureReports: failures, minimumReports: 5,
    authority: 'reported-outcomes-advisory-only', change: promote && base !== tiers[2] ? 'suggest-promotion' : 'retain-baseline',
    automaticDowngrade: false };
}
function view(record) {
  return { taskId: record.taskId, policyVersion: record.policyVersion, taskClass: record.taskClass,
    modules: record.modules, stage: record.stage, state: record.state,
    recommendation: record.recommendation, adaptation: record.adaptation,
    execution: { actualModel: null, actualEffort: null, actualUsage: null,
      reportedModel: record.feedback?.reportedModel ?? null, requestedEffort: record.requestedEffort ?? null,
      evidence: 'unknown-host-telemetry', hostControlsPrimaryModel: true },
    requiredValidation: record.validationCategories, independentReviewRequired: record.independentReviewRequired,
    feedback: record.feedback ?? null,
    completion: { verified: false, evidence: record.feedback ? 'reported-only' : 'pending',
      note: 'A completed model turn or reported result is not verification or independent-review evidence.' } };
}

export function createNativeAllocation({ knowledge, probe = probeCodexRuntime, clock = Date.now } = {}) {
  let catalogCache = null;
  let catalogTime = 0;
  let catalogPending = null;
  async function catalog() {
    if (catalogCache && clock() - catalogTime < 60000) return catalogCache;
    if (!catalogPending) catalogPending = probe({ cwd: knowledge.root, codexBin: process.env.TOTEM_CODEX_BIN || 'codex' }).then(result => {
      catalogCache = result; catalogTime = clock(); return result;
    }).finally(() => { catalogPending = null; });
    return catalogPending;
  }
  return {
    async start({ query, module_id = null, requested_model = null, requested_effort = null }) {
      if (typeof query !== 'string' || !query.trim() || query.length > 120000) throw new Error('Provide a bounded task');
      if (requested_model !== null && !MODEL_ID.test(requested_model)) throw new Error('Invalid requested model');
      if (requested_effort !== null && !['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(requested_effort)) throw new Error('Invalid requested effort');
      const plan = buildOrchestrationPlan({ query, moduleId: module_id, knowledge });
      const taskClass = allocationTaskClass(query, plan);
      const base = taskClass === 'critical' ? tiers[2] : taskClass === 'implementation' ? tiers[1] : tiers[0];
      const dimensions = { taskClass, modules: plan.affectedModules, contracts: plan.contracts.map(c => c.id).sort(),
        risks: plan.riskConstraints, validation: plan.requiredValidation.validationCategories, review: plan.independentReviewRequired };
      const comparisonKey = createHash('sha256').update(JSON.stringify(dimensions)).digest('hex');
      const saved = records(knowledge.root);
      if (saved.length >= MAX_RECORDS) throw new Error('Native allocation record limit reached; no history was deleted');
      const comparable = saved.filter(item => item.policyVersion === ALLOCATION_POLICY_VERSION && item.comparisonKey === comparisonKey
        && Number.isFinite(item.createdAt) && item.createdAt <= clock() && clock() - item.createdAt <= MAX_AGE_MS);
      const adaptation = adaptivePreference(base, comparable);
      const runtime = await catalog();
      const policy = resolveModelPolicy({ plan, advisoryPreference: adaptation.preference, models: runtime.models, usage: runtime.usage,
        requestedModel: requested_model, requestedEffort: requested_effort,
        contextTokens: Math.ceil(query.length / 4) });
      const record = { schemaVersion: 1, policyVersion: ALLOCATION_POLICY_VERSION, taskId: randomUUID(), createdAt: clock(),
        comparisonKey, taskClass, modules: plan.affectedModules, stage: 'discovery', state: 'running',
        validationCategories: plan.requiredValidation.validationCategories, independentReviewRequired: plan.independentReviewRequired,
        requestedEffort: requested_effort, adaptation,
        recommendation: { model: policy.coordinator.model, effort: policy.coordinator.effort,
          mode: policy.mode, reasons: policy.reasonCodes, advisory: true,
          catalogCheckedAt: runtime.checkedAt ?? null, availableModels: policy.availableModels.map(item => item.model) } };
      // Persist coarse allowlisted dimensions only, never the task text or a hash of it.
      // Check and reserve capacity after the asynchronous catalog read, across MCP processes.
      const directory = safeDirectory(knowledge.root, true);
      const lock = path.join(directory, 'creation.lock');
      try { fs.mkdirSync(lock, { mode: 0o700 }); }
      catch { throw new Error('Allocation creation is busy; retry after the current start'); }
      try {
        const count = fs.readdirSync(directory).filter(name => TASK_ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).length;
        if (count >= MAX_RECORDS) throw new Error('Native allocation record limit reached; no history was deleted');
        writeRecord(knowledge.root, record, true);
      } finally { fs.rmdirSync(lock); }
      return { ...view(record), constraints: { readScope: plan.readScope, writeScope: plan.writeScope,
        execution: plan.execution, dependencyOrdering: plan.dependencyOrdering,
        securityConstraints: plan.securityConstraints, releaseConstraints: plan.releaseConstraints } };
    },
    status({ task_id, reported_stage = null }) {
      if (reported_stage !== null && !STAGES.has(reported_stage)) throw new Error('Invalid reported stage');
      if (reported_stage === null) return view(readRecord(knowledge.root, task_id));
      return view(withRecord(knowledge.root, task_id, record => {
        if (record.feedback) throw new Error('Task already has terminal feedback');
        record.stage = reported_stage;
      }));
    },
    feedback({ task_id, outcome, reported_model = null, validation = 'unknown', review = 'unknown' }) {
      if (!OUTCOMES.has(outcome)) throw new Error('Invalid task outcome');
      if (reported_model !== null && !MODEL_ID.test(reported_model)) throw new Error('Invalid reported model');
      if (![validation, review].every(value => ['unknown', 'passed', 'failed', 'not-required'].includes(value))) throw new Error('Invalid reported evidence status');
      return view(withRecord(knowledge.root, task_id, record => {
        if (record.feedback) throw new Error('Feedback is immutable; duplicate reports cannot become extra samples');
        if (reported_model !== null && !record.recommendation.availableModels.includes(reported_model)
          && !/^gpt-[0-9.]+-(?:astra|sol|luna)$/.test(reported_model)) throw new Error('Use a catalog model ID or leave the reported model unknown');
        record.feedback = { outcome, reportedModel: reported_model, validation, review, authority: 'session-reported', recordedAt: clock() };
        record.state = outcome === 'success' ? 'awaiting-evidence' : outcome;
      }));
    }
  };
}
