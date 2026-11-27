#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createThreadClient, spawnThreadClient } from '../intelligence/agent-runtime/thread-client.mjs';
import { listItems, listThreads, listTurns, readThreadMetadata } from '../intelligence/agent-runtime/thread-history.mjs';

const PREFIX = 'totem-codex-thread-m1-';
const TIMEOUT_MS = 15_000;
const THREAD_PAGE_SIZE = 10;
const FIXTURE_THREAD_COUNT = THREAD_PAGE_SIZE + 1;
const FOUR_TURN_FIXTURE_COUNT = 4;
const FOUR_TURN_PAGE_SIZE = 3;

function requireOptIn(args) {
  if (!args.includes('--confirm-isolated-history-read')
    || args.some(arg => !['--confirm-isolated-history-read', '--allow-one-model-turn', '--allow-four-root-model-turns'].includes(arg))
    || args.includes('--allow-one-model-turn') && args.includes('--allow-four-root-model-turns')) {
    throw new Error('Pass --confirm-isolated-history-read; choose at most one of --allow-one-model-turn or --allow-four-root-model-turns.');
  }
  return { allowOneModelTurn: args.includes('--allow-one-model-turn'),
    allowFourRootModelTurns: args.includes('--allow-four-root-model-turns') };
}

function createControlClient({ cwd, env }) {
  const child = spawn('codex', ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  let nextId = 1;
  let buffer = '';
  let closed = false;
  let failure = null;
  const events = [];
  const subscribers = new Set();
  child.on('error', () => { failure = new Error('App Server unavailable'); fail(); });
  child.on('close', () => { closed = true; fail(); });
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) { failure = new Error('App Server response exceeded probe bounds'); fail(); child.kill('SIGTERM'); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { failure = new Error('Malformed App Server frame'); fail(); child.kill('SIGTERM'); return; }
      if (typeof message.method === 'string') {
        events.push({ method: message.method,
          threadId: message.params?.threadId ?? message.params?.turn?.threadId ?? null,
          turnId: message.params?.turnId ?? message.params?.turn?.id ?? null,
          status: message.params?.turn?.status ?? null });
        continue;
      }
      for (const subscriber of subscribers) subscriber(message);
      const call = pending.get(String(message.id));
      if (!call) continue;
      pending.delete(String(message.id)); clearTimeout(call.timer);
      if (message.error) {
        const text = String(message.error.message ?? '').toLowerCase();
        const rpcErrorKind = /unknown method|method not found|unsupported/.test(text) ? 'unsupported-method'
          : /invalid params|invalid request/.test(text) ? 'invalid-request-or-params' : 'other';
        call.reject(Object.assign(new Error('App Server RPC failed'), { rpcCode: message.error.code, rpcErrorKind }));
      }
      else call.resolve(message.result);
    }
  });
  function fail() {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(failure ?? new Error('App Server closed')); }
    pending.clear();
  }
  function request(method, params = {}) {
    if (closed || failure) return Promise.reject(failure ?? new Error('App Server closed'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(String(id)); reject(new Error('App Server probe timed out')); }, TIMEOUT_MS);
      pending.set(String(id), { resolve, reject, timer });
      try { child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); }
      catch { clearTimeout(timer); pending.delete(String(id)); reject(new Error('App Server request failed')); }
    });
  }
  async function start() {
    await request('initialize', { clientInfo: { name: 'totem_thread_history_m1_probe', title: 'Totem Thread History M1 Probe', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
  }
  return {
    start,
    request,
    events,
    sendRaw(message) { child.stdin.write(`${JSON.stringify(message)}\n`); },
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    async close() {
      if (closed) return true;
      await new Promise(resolve => {
        let termTimer;
        let killTimer;
        let deadlineTimer;
        const finish = () => {
          clearTimeout(termTimer); clearTimeout(killTimer); clearTimeout(deadlineTimer);
          child.off('close', finish);
          resolve();
        };
        child.once('close', finish);
        if (closed) { finish(); return; }
        termTimer = setTimeout(() => { if (!closed) child.kill('SIGTERM'); }, 500);
        killTimer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 2_500);
        deadlineTimer = setTimeout(finish, 4_000);
        child.stdin.end();
      });
      return closed;
    }
  };
}

async function archiveFixtureThreads({ cwd, env, threadIds }) {
  const client = createControlClient({ cwd, env });
  const archived = [];
  let error = null;
  let phase = 'initialize';
  try {
    await client.start();
    phase = 'archive';
    for (const threadId of threadIds) {
      await client.request('thread/archive', { threadId });
      archived.push(threadId);
    }
  } catch (caught) {
    error = { phase, rpcCode: Number.isSafeInteger(caught?.rpcCode) ? caught.rpcCode : null,
      rpcErrorKind: ['unsupported-method', 'invalid-request-or-params', 'other'].includes(caught?.rpcErrorKind)
        ? caught.rpcErrorKind : null };
  }
  const closed = await client.close().catch(() => false);
  return { archived, closed, error };
}

async function runFixtureTurn({ control, threadId, cwd }) {
  await control.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: 'Reply with exactly one word: ready.' }],
    cwd,
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: { type: 'readOnly' },
    effort: 'low'
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !control.events.some(event => event.method === 'turn/completed'
    && event.threadId === threadId && event.status === 'completed')) {
    if (control.events.some(event => event.method === 'turn/completed' && event.threadId === threadId
      && event.status !== 'completed')) throw new Error('Disposable fixture turn did not complete normally');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const starts = control.events.filter(event => event.method === 'turn/started' && event.threadId === threadId);
  const completed = control.events.filter(event => event.method === 'turn/completed'
    && event.threadId === threadId && event.status === 'completed');
  if (starts.length !== 1 || completed.length !== 1) throw new Error('Fixture turn completion was not observed within one bounded turn');
}

async function run() {
  const { allowOneModelTurn, allowFourRootModelTurns } = requireOptIn(process.argv.slice(2));
  const pageSize = allowFourRootModelTurns ? FOUR_TURN_PAGE_SIZE : THREAD_PAGE_SIZE;
  const fixtureThreadCount = allowFourRootModelTurns ? FOUR_TURN_FIXTURE_COUNT : FIXTURE_THREAD_COUNT;
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 5_000 });
  if (version.status !== 0) throw new Error('Unable to determine the installed Codex version');
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), PREFIX));
  const cwd = path.join(fixtureRoot, 'workspace');
  const codexHome = path.join(fixtureRoot, 'codex-home');
  let authBytes;
  let control;
  let history;
  let env;
  let controlTurnStartedCount = null;
  const fixtureThreadIds = [];
  let fixtureCleanupConfirmed = false;
  let cleanupCloseUnconfirmed = false;
  let modelTurnStartAttempted = false;
  let modelTurnInFlight = false;
  const report = { codexVersion: version.stdout.trim().slice(0, 80), isolated: true,
    boundedModelTurnRequested: allowOneModelTurn || allowFourRootModelTurns,
    modelTurnCap: allowFourRootModelTurns ? FOUR_TURN_FIXTURE_COUNT : allowOneModelTurn ? 1 : 0,
    modelTurns: null, phase: 'setup' };
  try {
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    const sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    try { authBytes = await readFile(path.join(sourceHome, 'auth.json')); }
    catch { throw new Error('File-backed Codex authentication is unavailable; no App Server was started.'); }
    await writeFile(path.join(codexHome, 'auth.json'), authBytes, { mode: 0o600 });
    authBytes.fill(0);
    await writeFile(path.join(cwd, 'history-fixture.txt'), 'Disposable M1 history fixture.\n', { mode: 0o600 });
    env = { ...process.env, CODEX_HOME: codexHome };
    for (const key of Object.keys(env)) {
      if (/^VSCODE_/.test(key) || ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_TOOL_CALL_ID'].includes(key)) delete env[key];
    }

    report.phase = 'create-disposable-thread';
    control = createControlClient({ cwd, env });
    await control.start();
    const started = await control.request('thread/start', { cwd, approvalPolicy: 'on-request', sandbox: 'read-only' });
    const threadId = started?.thread?.id;
    if (typeof threadId !== 'string' || !threadId) throw new Error('Disposable thread was not created');
    fixtureThreadIds.push(threadId);
    report.fixtureThreadCount = fixtureThreadCount;
    report.fixtureModelTurnCap = report.modelTurnCap;
    const startOneModelTurn = async targetThreadId => {
      modelTurnStartAttempted = true;
      modelTurnInFlight = true;
      await runFixtureTurn({ control, threadId: targetThreadId, cwd });
      modelTurnInFlight = false;
    };
    if (allowOneModelTurn) {
      report.phase = 'create-single-turn-fixture';
      await startOneModelTurn(threadId);
    } else if (allowFourRootModelTurns) {
      report.phase = 'create-indexed-root-fixtures';
      await startOneModelTurn(threadId);
      for (let index = 1; index < fixtureThreadCount; index++) {
        const extra = await control.request('thread/start', { cwd, approvalPolicy: 'on-request', sandbox: 'read-only' });
        const extraId = extra?.thread?.id;
        if (typeof extraId !== 'string' || !extraId || fixtureThreadIds.includes(extraId)) {
          throw new Error('Additional disposable history root was missing or duplicated');
        }
        fixtureThreadIds.push(extraId);
        await startOneModelTurn(extraId);
      }
    } else {
      for (let index = 1; index < fixtureThreadCount; index++) {
        const extra = await control.request('thread/start', { cwd, approvalPolicy: 'on-request', sandbox: 'read-only' });
        const extraId = extra?.thread?.id;
        if (typeof extraId !== 'string' || !extraId || fixtureThreadIds.includes(extraId)) {
          throw new Error('Additional disposable history thread was missing or duplicated');
        }
        fixtureThreadIds.push(extraId);
      }
    }
    const adapter = createThreadClient({ send: message => control.sendRaw(message), initialRequestId: 100 });
    const unsubscribe = control.subscribe(message => adapter.receive(message));
    const sameServerMetadata = await readThreadMetadata(adapter, { threadId, cwd });
    report.sameServerMetadataRead = sameServerMetadata.id === threadId && sameServerMetadata.cwd === cwd;
    if (allowOneModelTurn) {
      const turnPage = await listTurns(adapter, { threadId });
      report.turnPageResponseValid = Array.isArray(turnPage.turns) && turnPage.turns.some(turn => turn.status === 'completed');
      const turnId = turnPage.turns.find(turn => turn.status === 'completed')?.id;
      if (!turnId) throw new Error('Completed fixture turn was absent from the App Server summary page');
      report.fixtureForkCount = 0;
      report.forkedThreadsHaveCompletedHistory = true;
      for (let index = 1; index < FIXTURE_THREAD_COUNT; index++) {
        const forked = await control.request('thread/fork', {
          threadId,
          lastTurnId: turnId,
          deferGoalContinuation: true
        });
        const forkId = forked?.thread?.id;
        if (typeof forkId !== 'string' || !forkId || fixtureThreadIds.includes(forkId)) {
          throw new Error('Additional disposable history fork was missing or duplicated');
        }
        fixtureThreadIds.push(forkId);
        report.fixtureForkCount++;
        const inheritedPage = await listTurns(adapter, { threadId: forkId });
        if (!inheritedPage.turns.some(turn => turn.status === 'completed')) {
          report.forkedThreadsHaveCompletedHistory = false;
          throw new Error('Disposable history fork did not retain a completed turn');
        }
      }
      const itemPage = await listItems(adapter, { threadId, turnId });
      report.itemPageResponseValid = Array.isArray(itemPage.messages);
      report.visibleHistoryRoles = itemPage.messages.map(message => message.role);
    } else if (allowFourRootModelTurns) {
      report.rootThreadsHaveCompletedHistory = true;
      for (const rootThreadId of fixtureThreadIds) {
        const rootTurns = await listTurns(adapter, { threadId: rootThreadId });
        if (!rootTurns.turns.some(turn => turn.status === 'completed')) {
          report.rootThreadsHaveCompletedHistory = false;
          throw new Error('A disposable indexed root lacked a completed history turn');
        }
      }
    }
    await adapter.close();
    unsubscribe();
    controlTurnStartedCount = control.events.filter(event => event.method === 'turn/started').length;
    await control.close();
    control = null;

    report.phase = 'read-through-history-client';
    history = spawnThreadClient({ cwd, env });
    const client = await history.start();
    const listed = await listThreads(client, { workspaces: [cwd], limit: pageSize });
    const pageOneIds = listed.threads.map(thread => thread.id);
    const pageTwo = listed.nextCursors.length
      ? await listThreads(client, { workspaces: [cwd], cursors: listed.nextCursors, limit: pageSize }) : null;
    const pageTwoIds = pageTwo?.threads.map(thread => thread.id) ?? [];
    const pagedIds = [...pageOneIds, ...pageTwoIds];
    const listedFixtureThread = pagedIds.includes(threadId);
    const crossProcessMetadata = listedFixtureThread ? await readThreadMetadata(client, { threadId, cwd }) : null;
    report.modelTurns = controlTurnStartedCount;
    const expectedModelTurns = report.modelTurnCap;
    if (report.modelTurns !== expectedModelTurns) throw new Error('Unexpected fixture model-turn count');
    const uniquePagedIds = new Set(pagedIds);
    report.multiPageThreadList = {
      pageSize,
      fixtureThreadCount: fixtureThreadIds.length,
      firstPageCount: pageOneIds.length,
      cursorReturned: listed.nextCursors.length === 1,
      secondPageCount: pageTwoIds.length,
      secondPageHasNoDuplicates: pageOneIds.every(id => !pageTwoIds.includes(id)),
      allFixtureThreadsPresent: fixtureThreadIds.every(id => uniquePagedIds.has(id)),
      distinctThreadsAcrossPages: uniquePagedIds.size === pagedIds.length,
      paginationEnded: pageTwo !== null && pageTwo.nextCursors.length === 0
    };
    const paginationProven = fixtureThreadIds.length === fixtureThreadCount
      && report.multiPageThreadList.cursorReturned
      && report.multiPageThreadList.firstPageCount === pageSize
      && report.multiPageThreadList.secondPageCount >= 1
      && report.multiPageThreadList.secondPageHasNoDuplicates
      && report.multiPageThreadList.allFixtureThreadsPresent
      && report.multiPageThreadList.distinctThreadsAcrossPages
      && report.multiPageThreadList.paginationEnded;
    if (paginationProven) {
      report.multiPageThreadList.result = 'pass';
    } else {
      report.multiPageThreadList.result = report.multiPageThreadList.firstPageCount === 0
        ? 'not-proven-empty-native-index' : 'not-proven-fixture-not-indexed-across-pages';
      report.multiPageThreadList.note = 'App Server did not index enough fixture threads for pagination; no model turns beyond the explicit probe cap were started.';
    }
    report.result = {
      sameServerMetadataRead: report.sameServerMetadataRead,
      crossProcessThreadVisible: listedFixtureThread,
      ...(crossProcessMetadata ? { crossProcessMetadataIdentityMatches: crossProcessMetadata.id === threadId,
        crossProcessMetadataCwdMatches: crossProcessMetadata.cwd === cwd, sourceKind: crossProcessMetadata.source } : {}),
      listResponseShapeValid: Array.isArray(listed.threads) && Array.isArray(listed.nextCursors)
        && (!pageTwo || Array.isArray(pageTwo.threads) && Array.isArray(pageTwo.nextCursors)),
      listLength: pagedIds.length,
      cursorCount: listed.nextCursors.length
    };
    await history.close();
    history = null;
    report.phase = 'archive-disposable-fixtures';
    if (!allowOneModelTurn && !allowFourRootModelTurns && pageOneIds.length === 0) {
      report.archivedFixtureThreadCount = 0;
      report.fixtureCleanupDisposition = 'empty threads were absent from the native index; isolated profile will be removed after confirmed process close';
      fixtureCleanupConfirmed = true;
    } else {
      const cleanup = await archiveFixtureThreads({ cwd, env, threadIds: fixtureThreadIds });
      report.archivedFixtureThreadCount = cleanup.archived.length;
      cleanupCloseUnconfirmed = !cleanup.closed;
      report.fixtureCleanupError = cleanup.error;
      if (!cleanup.closed || cleanup.archived.length !== fixtureThreadIds.length || cleanup.error) {
        report.recoveryRequired = true;
        report.recoveryRequiredPath = fixtureRoot;
        throw new Error('Disposable thread cleanup was not fully confirmed; fixture profile preserved');
      }
      fixtureCleanupConfirmed = true;
    }
    report.phase = 'complete';
  } catch (error) {
    error.phase = report.phase;
    error.diagnostic = report;
    throw error;
  } finally {
    authBytes?.fill(0);
    let processesClosed = !cleanupCloseUnconfirmed;
    if (control) processesClosed = await control.close().catch(() => false) && processesClosed;
    if (history) {
      try { await history.close(); } catch { processesClosed = false; }
    }
    if (processesClosed && fixtureThreadIds.length && !fixtureCleanupConfirmed
        && (!modelTurnStartAttempted || !modelTurnInFlight)) {
      const cleanup = await archiveFixtureThreads({ cwd, env, threadIds: fixtureThreadIds });
      report.archivedFixtureThreadCount = cleanup.archived.length;
      report.fixtureCleanupError = cleanup.error;
      cleanupCloseUnconfirmed = !cleanup.closed;
      if (!cleanup.closed) processesClosed = false;
      fixtureCleanupConfirmed = cleanup.closed && cleanup.archived.length === fixtureThreadIds.length && !cleanup.error;
    }
    if (!fixtureThreadIds.length) fixtureCleanupConfirmed = processesClosed;
    if (processesClosed && fixtureCleanupConfirmed) {
      try { await rm(fixtureRoot, { recursive: true, force: true }); }
      catch {
        report.recoveryRequired = true;
        report.recoveryRequiredPath = fixtureRoot;
        throw Object.assign(new Error('Disposable fixture profile could not be removed'), {
          phase: 'remove-disposable-profile', diagnostic: report
        });
      }
      delete report.recoveryRequired;
      delete report.recoveryRequiredPath;
    }
    else {
      report.recoveryRequired = true;
      report.recoveryRequiredPath = fixtureRoot;
    }
  }
  if (report.phase === 'complete' && !report.recoveryRequired) console.log(JSON.stringify(report, null, 2));
}

run().catch(error => {
  console.error(JSON.stringify({ error: error.message, phase: error.phase ?? null, rpcCode: error.rpcCode ?? null,
    rpcMethod: error.rpcMethod ?? null, rpcErrorKind: error.rpcErrorKind ?? null,
    recoveryRequiredPath: error.diagnostic?.recoveryRequiredPath ?? null, diagnostic: error.diagnostic ?? null }));
  process.exitCode = 1;
});
