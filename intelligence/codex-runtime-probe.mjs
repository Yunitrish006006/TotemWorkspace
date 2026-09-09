import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isLightweightModel, isStrongReasoningModel } from './model-policy.mjs';

const cleanId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,100}$/.test(value) ? value : null;
function cleanWindow(window) {
  if (!window || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) return null;
  return { usedPercent: window.usedPercent,
    ...(Number.isFinite(window.windowDurationMins) ? { windowDurationMins: window.windowDurationMins } : {}),
    ...(Number.isFinite(window.resetsAt) ? { resetsAt: window.resetsAt } : {}) };
}
function cleanUsage(result, checkedAt) {
  const cleanSnapshot = (value, id) => ({ limitId: id, primary: cleanWindow(value?.primary), secondary: cleanWindow(value?.secondary),
    credits: { unlimited: value?.credits?.unlimited === true, hasCredits: value?.credits?.hasCredits === true,
      balance: Number.isFinite(Number(value?.credits?.balance)) ? Number(value.credits.balance) : null },
    spendControlReached: value?.spendControlReached === true,
    rateLimitReachedType: value?.rateLimitReachedType === 'codexRateLimits' ? 'codexRateLimits' : null });
  const rateLimitsByLimitId = {};
  for (const id of ['codex', 'codex_bengalfox']) {
    const value = result?.rateLimitsByLimitId?.[id] ?? (result?.rateLimits?.limitId === id ? result.rateLimits : null);
    if (value) rateLimitsByLimitId[id] = cleanSnapshot(value, id);
  }
  return { checkedAt, rateLimitsByLimitId };
}
function cleanModel(model) {
  const id = cleanId(model?.model ?? model?.id);
  if (!id) return null;
  const supportedReasoningEfforts = (model.supportedReasoningEfforts ?? []).map(entry => cleanId(typeof entry === 'string' ? entry : entry.reasoningEffort)).filter(Boolean);
  return { id, model: id, hidden: model.hidden === true, isDefault: model.isDefault === true,
    available: model.available !== false,
    ...(Number.isFinite(model.contextWindow) ? { contextWindow: model.contextWindow } : {}),
    ...(Number.isFinite(model.costPerToken) ? { costPerToken: model.costPerToken } : {}),
    capabilities: { lightweight: model.capabilities?.lightweight === true, strongReasoning: model.capabilities?.strongReasoning === true },
    defaultReasoningEffort: cleanId(model.defaultReasoningEffort), supportedReasoningEfforts,
    inputModalities: (model.inputModalities ?? []).filter(value => ['text', 'image'].includes(value)) };
}

/** Read-only app-server discovery: never starts a thread or a model turn. */
export async function probeCodexRuntime({ codexBin = 'codex', cwd, env = process.env, spawnImpl = spawn, spawnSyncImpl = spawnSync, timeoutMs = 15000 } = {}) {
  const checkedAt = Date.now();
  let child;
  let timer;
  let killTimer;
  let closed = false;
  let stopped = false;
  let nextId = 1;
  let buffer = '';
  let bytes = 0;
  const capabilities = { cliAvailable: false, version: null, appServerAvailable: false,
    modelCatalogAvailable: false, astraAvailable: false, lightweightAvailable: false,
    mcpAvailable: false, intelligenceAvailable: false };
  try {
    const version = spawnSyncImpl(codexBin, ['--version'], { cwd, env, encoding: 'utf8',
      timeout: 5000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!version.error && version.status === 0) {
      capabilities.cliAvailable = true;
      capabilities.version = /\b\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?\b/.exec(version.stdout ?? '')?.[0] ?? null;
    }
  } catch { /* Initialization can still establish App Server availability. */ }
  for (let dir = path.resolve(cwd ?? process.cwd());; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'TotemWorkspace', 'intelligence', 'orchestration-plan.mjs'))
      || existsSync(path.join(dir, 'intelligence', 'orchestration-plan.mjs'))) capabilities.intelligenceAvailable = true;
    if (path.dirname(dir) === dir) break;
  }
  const pending = new Map();
  const fail = () => {
    stopped = true;
    for (const request of pending.values()) request.reject(new Error('runtime-probe-unavailable'));
    pending.clear();
  };
  const empty = () => ({ models: [], usage: cleanUsage(null, checkedAt), checkedAt, capabilities });
  try {
    child = spawnImpl(codexBin, ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('error', fail);
    child.on('close', () => { closed = true; clearTimeout(killTimer); fail(); });
    child.stdin.on('error', fail);
    child.stderr.on('data', () => {}); // Drain diagnostics, never expose credentials/raw error text.
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 2 * 1024 * 1024) { fail(); return; }
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { fail(); return; }
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) request.reject(new Error('runtime-probe-unavailable'));
        else request.resolve(message.result);
      }
    });
    function request(method, params = {}) {
      if (stopped) return Promise.reject(new Error('runtime-probe-unavailable'));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        try { child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); }
        catch { fail(); }
      });
    }
    timer = setTimeout(fail, Math.max(1, Math.min(60000, timeoutMs)));
    const initialized = await request('initialize', { clientInfo: { name: 'totem_workspace_preflight', version: '2.0.0' }, capabilities: { experimentalApi: true } });
    capabilities.cliAvailable = true;
    capabilities.appServerAvailable = true;
    capabilities.version ??= /codex[^\s]*[ /]([\d.]+)/i.exec(initialized?.userAgent ?? '')?.[1] ?? null;
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const readModels = async () => {
      const models = [];
      const cursors = new Set();
      let cursor = null;
      for (let page = 0; page < 20; page++) {
        const result = await request('model/list', { cursor, limit: 100, includeHidden: false });
        if (!Array.isArray(result?.data)) throw new Error('runtime-probe-unavailable');
        models.push(...result.data.map(cleanModel).filter(Boolean));
        if (!result.nextCursor) return models;
        if (typeof result.nextCursor !== 'string' || cursors.has(result.nextCursor)) throw new Error('runtime-probe-unavailable');
        cursor = result.nextCursor;
        cursors.add(cursor);
      }
      throw new Error('runtime-probe-unavailable');
    };
    const readMcp = async () => {
      let cursor = null;
      const seen = new Set();
      for (let page = 0; page < 20; page++) {
        const result = await request('mcpServerStatus/list', { cursor, limit: 100 });
        if (!Array.isArray(result?.data)) return false;
        const available = result.data.some(server => Object.keys(server.tools ?? {}).some(name => /resolve_task|orchestration_plan/.test(name)));
        if (available) return true;
        if (!result.nextCursor || seen.has(result.nextCursor)) return false;
        cursor = result.nextCursor;
        seen.add(cursor);
      }
      return false;
    };
    const [modelResult, usageResult, mcpResult] = await Promise.allSettled([readModels(), request('account/rateLimits/read'), readMcp()]);
    const models = modelResult.status === 'fulfilled' ? modelResult.value : [];
    capabilities.modelCatalogAvailable = modelResult.status === 'fulfilled';
    capabilities.astraAvailable = models.some(model => !model.hidden && model.available && isStrongReasoningModel(model));
    capabilities.lightweightAvailable = models.some(model => !model.hidden && model.available && isLightweightModel(model));
    capabilities.mcpAvailable = mcpResult.status === 'fulfilled' && mcpResult.value;
    return { models, capabilities,
      usage: cleanUsage(usageResult.status === 'fulfilled' ? usageResult.value : null, checkedAt), checkedAt };
  } catch {
    return empty();
  } finally {
    clearTimeout(timer);
    fail();
    if (child && !closed) {
      try { child.stdin.end(); child.kill('SIGTERM'); } catch {}
      if (!closed) {
        killTimer = setTimeout(() => { if (!closed) { try { child.kill('SIGKILL'); } catch {} } }, 250);
        killTimer.unref?.();
      }
    }
  }
}
