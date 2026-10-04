import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createNativeAllocation, adaptivePreference } from '../intelligence/native-allocation.mjs';
import { loadKnowledge } from '../intelligence/workspace-knowledge.mjs';
import { resolveModelPolicy } from '../intelligence/model-policy.mjs';
import { taskIntent } from '../intelligence/task-intent.mjs';
import { buildOrchestrationPlan } from '../intelligence/orchestration-plan.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-native-allocation-'));
const root = path.join(temporary, 'repo'); fs.mkdirSync(root);
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
git('init'); fs.appendFileSync(path.join(root, '.git/info/exclude'), '\n.totem-index/\n');
const knowledge = { ...loadKnowledge(), root };
const models = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-luna'].map(model => ({ model,
  inputModalities: ['text', 'image'], supportedReasoningEfforts: ['low', 'medium', 'high'], contextWindow: 10000 }));
let now = 1800000000000;
let probes = 0;
const probe = async () => { probes++; return { models, checkedAt: now }; };
const service = createNativeAllocation({ knowledge, probe, clock: () => now });
const start = (query = 'Fix local allocation behavior', extra = {}) => service.start({ query, module_id: 'totem-workspace', ...extra });
try {
  const [first, other] = await Promise.all([start(), start()]);
  assert.equal(probes, 1, 'Concurrent requests reuse one catalog read');
  assert.notEqual(first.taskId, other.taskId);
  assert.equal(first.recommendation.model, 'gpt-6.1-sol', 'Latest available balanced model is selected');
  assert.equal(first.execution.actualModel, null);
  assert.equal(first.execution.actualUsage, null);
  assert.equal(first.completion.verified, false);
  assert.equal(service.status({ task_id: first.taskId, reported_stage: 'verification' }).stage, 'verification');
  const report = service.feedback({ task_id: first.taskId, outcome: 'success', reported_model: 'gpt-6.1-sol', validation: 'passed', review: 'passed' });
  assert.equal(report.state, 'awaiting-evidence');
  assert.equal(report.execution.actualModel, null, 'A reported model never becomes actual runtime evidence');
  assert.equal(report.completion.verified, false, 'Passed claims never certify task completion');
  assert.throws(() => service.feedback({ task_id: first.taskId, outcome: 'success' }), /immutable/);
  assert.throws(() => service.status({ task_id: first.taskId, reported_stage: 'implementation' }), /terminal/);
  for (const outcome of ['quality-failure', 'quality-failure', 'success', 'success']) {
    const task = await start(); service.feedback({ task_id: task.taskId, outcome });
  }
  const promoted = await start();
  assert.equal(promoted.adaptation.comparableReports, 5);
  assert.equal(promoted.adaptation.change, 'suggest-promotion');
  assert.equal(promoted.recommendation.model, 'gpt-6-astra');
  const explicit = await start(undefined, { requested_model: 'gpt-6.1-sol', requested_effort: 'high' });
  assert.equal(explicit.recommendation.model, 'gpt-6.1-sol');
  assert.equal(explicit.recommendation.effort, 'high');
  const inspection = await start('查看 TotemWorkspace 工作分配');
  assert.equal(inspection.taskClass, 'inspection');
  assert.equal(inspection.recommendation.model, 'gpt-6-luna');
  for (const query of ['幫我看看工作分配能不能更新', '檢視目前分配', 'Review code without edits', 'Can you explain allocation?']) assert.equal(taskIntent(query).readOnly, true);
  assert.equal(taskIntent('Show allocation gaps and add regression coverage').readOnly, false);
  assert.equal(buildOrchestrationPlan({ query: 'Review without edits', moduleId: 'totem-workspace', changedFiles: ['intelligence/example.mjs'], knowledge }).writeScope.length, 0);
  const critical = await start('Review runtime security contracts');
  assert.equal(critical.taskClass, 'critical');
  assert.equal(critical.recommendation.model, 'gpt-6-astra');
  const excluded = ['cancelled', 'quota-exhausted', 'infrastructure-failure', 'incomplete'].map(outcome => ({ feedback: { outcome } }));
  assert.equal(adaptivePreference('balanced-preferred', excluded).comparableReports, 0);
  assert.equal(adaptivePreference('strong-reasoning-preferred', Array(8).fill({ feedback: { outcome: 'quality-failure' } })).preference, 'strong-reasoning-preferred');
  now += 31 * 86400000;
  assert.equal((await start()).adaptation.comparableReports, 0, 'Old policy observations do not affect new tasks');
  const restarted = createNativeAllocation({ knowledge, probe, clock: () => now });
  assert.equal(restarted.status({ task_id: first.taskId }).state, 'awaiting-evidence');
  assert.throws(() => service.status({ task_id: '../escape' }), /Invalid/);
  assert.throws(() => service.feedback({ task_id: other.taskId, outcome: 'success', reported_model: 'private-secret' }), /catalog model/);
  const privateTask = await start('Fix local behavior PRIVATE_PROMPT_SENTINEL https://private.invalid/key');
  const stored = fs.readFileSync(path.join(root, '.totem-index/native-allocation', `${privateTask.taskId}.json`), 'utf8');
  assert.ok(!stored.includes('PRIVATE_PROMPT_SENTINEL') && !stored.includes('private.invalid'));
  const preference = { contextHints: { modelPreference: 'balanced-preferred' } };
  assert.equal(resolveModelPolicy({ plan: preference, models: models.filter(m => m.model !== 'gpt-6.1-sol') }).coordinator.model, 'gpt-6-sol');
  assert.equal(resolveModelPolicy({ plan: preference, models: [] }).mode, 'blocked');
  const maliciousRoot = path.join(temporary, 'malicious'); fs.mkdirSync(maliciousRoot);
  execFileSync('git', ['init'], { cwd: maliciousRoot, stdio: 'pipe' });
  fs.appendFileSync(path.join(maliciousRoot, '.git/info/exclude'), '\n.totem-index/\n');
  fs.symlinkSync(root, path.join(maliciousRoot, '.totem-index'));
  await assert.rejects(createNativeAllocation({ knowledge: { ...knowledge, root: maliciousRoot }, probe }).start({ query: 'Fix local behavior', module_id: 'totem-workspace' }), /inside|Git-ignored/);
  const hardPlan = { contextHints: { modelPreference: 'strong-reasoning-preferred' } };
  assert.equal(resolveModelPolicy({ plan: hardPlan, models, requestedModel: 'gpt-6.1-sol' }).coordinator.model, 'gpt-6-astra');
  assert.equal(resolveModelPolicy({ plan: hardPlan, models: models.filter(m => m.model !== 'gpt-6-astra') }).mode, 'blocked');
  const directory = path.join(root, '.totem-index/native-allocation');
  const fixture = JSON.parse(stored);
  const count = fs.readdirSync(directory).filter(name => name.endsWith('.json')).length;
  for (let i = count; i < 499; i++) {
    const taskId = `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, '0')}`;
    fs.writeFileSync(path.join(directory, `${taskId}.json`), JSON.stringify({ ...fixture, taskId }));
  }
  const boundary = await Promise.allSettled([start(), start()]);
  assert.equal(boundary.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.json')).length, 500);
  assert.equal(service.status({ task_id: first.taskId }).state, 'awaiting-evidence', 'Capacity cannot block existing tasks');
  service.feedback({ task_id: other.taskId, outcome: 'cancelled' });
  // Exercise the real asynchronous MCP transport against a read-only fake catalog.
  const sourceRoot = loadKnowledge().root;
  const mcpRoot = path.join(temporary, 'mcp'); fs.mkdirSync(mcpRoot);
  execFileSync('git', ['init'], { cwd: mcpRoot, stdio: 'pipe' });
  fs.appendFileSync(path.join(mcpRoot, '.git/info/exclude'), '\n.totem-index/\n');
  fs.mkdirSync(path.join(mcpRoot, 'data'));
  for (const name of ['modules.json', 'relationship-audit.json', 'aliases.json', 'test-matrix.json']) fs.copyFileSync(path.join(sourceRoot, 'data', name), path.join(mcpRoot, 'data', name));
  fs.copyFileSync(path.join(sourceRoot, 'index.html'), path.join(mcpRoot, 'index.html'));
  const fakeCodex = path.join(temporary, 'fake-codex');
  fs.writeFileSync(fakeCodex, `#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli 1.2.3'); process.exit(0); }
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); if (!('id' in m)) return;
 if (/thread\\/|turn\\//.test(m.method)) throw new Error('Model execution is forbidden');
 const result=m.method==='model/list' ? {data:[{model:'gpt-6.1-sol',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}],nextCursor:null} : {};
 console.log(JSON.stringify({id:m.id,result}));
});
`, { mode: 0o700 });
  const child = spawn(process.execPath, [path.join(sourceRoot, 'mcp/server.mjs')], {
    cwd: mcpRoot, env: { ...process.env, TOTEM_WORKSPACE_ROOT: mcpRoot, TOTEM_CODEX_BIN: fakeCodex }, stdio: ['pipe', 'pipe', 'pipe']
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map(); let sequence = 0;
  child.stderr.on('data', () => {});
  lines.on('line', line => { const message = JSON.parse(line); pending.get(message.id)?.(message.result); });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error('MCP allocation request timed out')), 5000);
    pending.set(id, result => { clearTimeout(timer); pending.delete(id); resolve(result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    const listed = await request('tools/list', {});
    for (const name of ['allocation_start', 'allocation_status', 'allocation_feedback']) assert.ok(listed.tools.some(tool => tool.name === name));
    const result = await request('tools/call', { name: 'allocation_start', arguments: { query: 'Fix local behavior', module_id: 'totem-workspace' } });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.recommendation.model, 'gpt-6.1-sol');
    const taskId = result.structuredContent.taskId;
    const status = await request('tools/call', { name: 'allocation_status', arguments: { task_id: taskId } });
    assert.equal(status.structuredContent.taskId, taskId);
    const finished = await request('tools/call', { name: 'allocation_feedback', arguments: { task_id: taskId, outcome: 'success', validation: 'passed' } });
    assert.equal(finished.structuredContent.state, 'awaiting-evidence');
    const duplicate = await request('tools/call', { name: 'allocation_feedback', arguments: { task_id: taskId, outcome: 'success' } });
    assert.equal(duplicate.isError, true);
  } finally { lines.close(); child.kill('SIGTERM'); }
  console.log('Native allocation passed: balanced routing, shared catalog, persistence, privacy, immutable reports, conservative adaptation, stale evidence, unknown telemetry and storage boundaries.');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
