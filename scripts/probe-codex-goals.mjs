#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { threadResumeParams } from '../intelligence/agent-runtime/runtime.mjs';

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_TURNS = (() => {
  const configured = process.env.TOTEM_GOAL_PROBE_MAX_GOAL_TURNS;
  if (configured === undefined) return 5;
  if (!/^[1-5]$/.test(configured)) throw new Error('TOTEM_GOAL_PROBE_MAX_GOAL_TURNS must be an integer from 1 through 5');
  return Number(configured);
})();
const RPC_TIMEOUT_MS = 20_000;
const TURN_TIMEOUT_MS = 120_000;
const CONTINUATION_OBSERVE_MS = 8_000;
const GOAL_BUDGET = 5_000;
const FIXTURE_PREFIX = 'totem-codex-goal-m0-';

function assertProbeOptIn(args) {
  if (args.length !== 1 || args[0] !== '--allow-model-turns') {
    throw new Error('This probe creates and archives test-only Codex threads and makes bounded model turns. Run with --allow-model-turns to confirm.');
  }
}

function createClient({ cwd, codexHome, codexBin = 'codex' }) {
  const env = { ...process.env, CODEX_HOME: codexHome };
  for (const key of Object.keys(env)) {
    if (/^VSCODE_/.test(key) || ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_TOOL_CALL_ID'].includes(key)) delete env[key];
  }
  const child = spawn(codexBin, ['app-server'], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  const events = [];
  let nextId = 0;
  let buffered = '';
  let bufferedBytes = 0;
  let stderrTail = '';
  let closed = false;
  let failure = null;
  let startedResolve;
  let startedReject;
  const closedPromise = new Promise((resolve, reject) => { startedResolve = resolve; startedReject = reject; });

  child.once('spawn', () => startedResolve());
  child.once('error', error => { failure = error; startedReject(error); });
  child.stderr.on('data', chunk => {
    stderrTail = `${stderrTail}${chunk.toString()}`.slice(-2_000);
  });
  child.once('close', (code, signal) => {
    closed = true;
    const diagnostic = stderrTail.toLowerCase();
    const category = /not logged in|authentication|unauthorized|login required/.test(diagnostic) ? 'authentication'
      : /permission denied|operation not permitted/.test(diagnostic) ? 'permission'
        : /config|toml|invalid value/.test(diagnostic) ? 'configuration'
          : /network|connect|dns|timed out/.test(diagnostic) ? 'network'
            : stderrTail ? 'other-stderr' : 'no-stderr';
    failure ??= Object.assign(new Error(`Codex App Server closed (code=${code ?? 'unknown'}, signal=${signal ?? 'none'}, diagnostic=${category})`), { stderrTail });
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(failure);
    }
    pending.clear();
  });

  function send(value) {
    if (closed || child.stdin.destroyed) throw failure ?? new Error('Codex App Server is closed');
    child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  child.stdout.on('data', chunk => {
    bufferedBytes += Buffer.byteLength(chunk);
    if (bufferedBytes > MAX_FRAME_BYTES) {
      failure = new Error('Codex App Server response exceeded the probe frame limit');
      child.kill('SIGTERM');
      return;
    }
    buffered += chunk.toString();
    let end;
    while ((end = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      bufferedBytes = Buffer.byteLength(buffered);
      let message;
      try { message = JSON.parse(line); }
      catch {
        failure = new Error('Codex App Server emitted an invalid JSON frame');
        child.kill('SIGTERM');
        return;
      }

      if (message.method && Object.hasOwn(message, 'id')) {
        // The probe never grants permissions or answers server initiated input.
        send({ id: message.id, error: { code: -32601, message: 'M0 probe declines server initiated requests' } });
        continue;
      }
      if (message.method) {
        events.push({ method: message.method, params: message.params ?? {}, at: Date.now() });
        continue;
      }
      if (!Object.hasOwn(message, 'id')) continue;
      const request = pending.get(String(message.id));
      if (!request) continue;
      pending.delete(String(message.id));
      clearTimeout(request.timer);
      if (message.error) request.reject(Object.assign(new Error('App Server RPC failed'), {
        code: message.error.code,
        rpcMessage: String(message.error.message ?? '').slice(0, 300)
      }));
      else request.resolve(message.result);
    }
  });

  async function start() {
    await closedPromise;
    const initialized = await request('initialize', {
      clientInfo: { name: 'totem_workspace_m0_goal_probe', title: 'TotemWorkspace M0 Probe', version: '0.1.0' },
      capabilities: { experimentalApi: true }
    });
    send({ method: 'initialized', params: {} });
    return initialized;
  }

  function request(method, params = {}, timeoutMs = RPC_TIMEOUT_MS) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error(`App Server ${method} timed out`));
      }, timeoutMs);
      pending.set(String(id), { resolve, reject, timer });
      try { send({ id, method, params }); }
      catch (error) {
        pending.delete(String(id));
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function close() {
    if (closed) return true;
    child.stdin.end();
    const closedGracefully = await Promise.race([
      new Promise(resolve => child.once('close', () => resolve(true))),
      new Promise(resolve => setTimeout(() => resolve(false), 2_000))
    ]);
    if (!closedGracefully) {
      child.kill('SIGTERM');
      const terminated = await Promise.race([
        new Promise(resolve => child.once('close', () => resolve(true))),
        new Promise(resolve => setTimeout(() => resolve(false), 2_000))
      ]);
      if (!terminated && !closed) {
        child.kill('SIGKILL');
        await Promise.race([
          new Promise(resolve => child.once('close', () => resolve(true))),
          new Promise(resolve => setTimeout(() => resolve(false), 2_000))
        ]);
      }
    }
    return closed;
  }

  return { child, events, start, request, close, get closed() { return closed; } };
}

function turnIdOf(event) {
  return event.params?.turnId ?? event.params?.turn?.id ?? null;
}

function safeEventSequence(events) {
  const threadRefs = new Map();
  const turnRefs = new Map();
  const ref = (map, id, kind) => {
    if (typeof id !== 'string' || !id) return null;
    if (!map.has(id)) map.set(id, `${kind}-${map.size + 1}`);
    return map.get(id);
  };
  const projected = events.slice(-300).map((event, index) => {
    const params = event.params ?? {};
    const threadId = params.threadId ?? params.thread?.id ?? params.turn?.threadId ?? null;
    const turnId = turnIdOf(event);
    return {
      order: events.length > 300 ? events.length - 300 + index : index + 1,
      method: event.method,
      thread: ref(threadRefs, threadId, 'thread'),
      turn: ref(turnRefs, turnId, 'turn'),
      turnStatus: params.turn?.status ?? null,
      itemType: params.item?.type ?? null,
      goalStatus: params.goal?.status ?? null,
      errorKind: params.error?.codexErrorInfo ? Object.keys(params.error.codexErrorInfo)[0] ?? 'unknown' : null
    };
  });
  return { events: projected, omittedEventCount: Math.max(0, events.length - projected.length) };
}

function turnsStarted(events, threadId) {
  return events.filter(event => event.method === 'turn/started'
    && (event.params?.threadId === threadId || event.params?.turn?.threadId === threadId));
}

function turnCompletions(events, threadId) {
  return events.filter(event => event.method === 'turn/completed'
    && (!event.params?.threadId || event.params.threadId === threadId));
}

async function waitUntil(check, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function pauseAndInterruptInFlightTurn(client, threadId) {
  const before = await client.request('thread/goal/get', { threadId });
  if (before?.goal?.status === 'active') {
    await client.request('thread/goal/set', { threadId, status: 'paused' });
  }
  const starts = turnsStarted(client.events, threadId);
  const activeStart = [...starts].reverse().find(start => {
    const turnId = turnIdOf(start);
    return turnId && !turnCompletions(client.events, threadId).some(completed => turnIdOf(completed) === turnId);
  });
  let interruptedTurn = false;
  if (activeStart) {
    const turnId = turnIdOf(activeStart);
    await client.request('turn/interrupt', { threadId, turnId });
    const completion = await waitUntil(() => turnCompletions(client.events, threadId)
      .find(event => turnIdOf(event) === turnId), 15_000, 'bounded turn interruption');
    interruptedTurn = completion.params?.turn?.status === 'interrupted';
  }
  const remainingActiveStarts = turnsStarted(client.events, threadId).filter(start => {
    const turnId = turnIdOf(start);
    return turnId && !turnCompletions(client.events, threadId).some(completed => turnIdOf(completed) === turnId);
  });
  if (remainingActiveStarts.length > 0) throw new Error('A probe turn remained active after bounded interruption');
  const after = await client.request('thread/goal/get', { threadId });
  return { goalStatus: after?.goal?.status ?? null, interruptedTurn, noInFlightTurn: true };
}

async function clearProbeGoalSafely(client, threadId) {
  let current = await client.request('thread/goal/get', { threadId });
  const hasUnfinishedTurn = turnsStarted(client.events, threadId).some(start => {
    const turnId = turnIdOf(start);
    return turnId && !turnCompletions(client.events, threadId).some(completed => turnIdOf(completed) === turnId);
  });
  if (current?.goal?.status === 'active' || hasUnfinishedTurn) {
    const stopped = await pauseAndInterruptInFlightTurn(client, threadId);
    if (!stopped.noInFlightTurn || !['paused', 'budgetLimited'].includes(stopped.goalStatus)) {
      throw new Error('Probe Goal could not be confirmed stopped before cleanup');
    }
    current = await client.request('thread/goal/get', { threadId });
  }
  if (current?.goal) {
    if (current.goal.status === 'active') throw new Error('Refusing to clear an active probe Goal');
    await client.request('thread/goal/clear', { threadId });
  }
  return !(await client.request('thread/goal/get', { threadId }))?.goal;
}

async function startTurn(client, { threadId, cwd, prompt }) {
  const before = turnCompletions(client.events, threadId).length;
  await client.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: prompt }],
    cwd,
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: { type: 'readOnly' }
  });
  return waitUntil(() => {
    const completions = turnCompletions(client.events, threadId);
    return completions.length > before ? completions.at(-1) : null;
  }, TURN_TIMEOUT_MS, 'bounded turn completion');
}

function safeThreadMetadata(thread) {
  return {
    idMatches: typeof thread?.id === 'string',
    cwdMatchesFixture: typeof thread?.cwd === 'string',
    source: typeof thread?.source === 'string' ? thread.source : null,
    threadSource: typeof thread?.threadSource === 'string' ? thread.threadSource : null,
    statusType: typeof thread?.status?.type === 'string' ? thread.status.type : null,
    canAcceptDirectInput: typeof thread?.canAcceptDirectInput === 'boolean' ? thread.canAcceptDirectInput : null
  };
}

function safeGoal(goal) {
  return goal ? {
    status: goal.status,
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: Number.isSafeInteger(goal.tokensUsed) ? goal.tokensUsed : null,
    timeUsedSeconds: Number.isSafeInteger(goal.timeUsedSeconds) ? goal.timeUsedSeconds : null,
    objectiveLength: typeof goal.objective === 'string' ? goal.objective.length : null
  } : null;
}

function safeDiagnostic(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b(Bearer|access[_-]?token|api[_-]?key|secret|password|authorization)\s*[:= ]+[^\s,;]+/gi, '$1=<redacted>')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/\/(?:home|tmp)\/[^\s"']+/g, '<path>')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, '<redacted>')
    .trim().slice(-350);
}

async function run() {
  assertProbeOptIn(process.argv.slice(2));
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 5_000 });
  if (version.status !== 0) throw new Error('Unable to determine the installed Codex version');

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), FIXTURE_PREFIX));
  const workspace = path.join(fixtureRoot, 'workspace');
  const codexHome = path.join(fixtureRoot, 'codex-home');
  const sourceCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const sourceAuthFile = path.join(sourceCodexHome, 'auth.json');
  let authBytes;
  const fixtures = ['stage-a.txt', 'stage-b.txt', 'stage-c.txt', 'stage-d.txt', 'stage-e.txt'];
  try {
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    try { authBytes = await readFile(sourceAuthFile); }
    catch { throw new Error('The probe requires file-backed Codex login credentials; no isolated profile was created.'); }
    await writeFile(path.join(codexHome, 'auth.json'), authBytes, { mode: 0o600 });
    authBytes.fill(0);
    const authStat = await stat(path.join(codexHome, 'auth.json'));
    if ((authStat.mode & 0o077) !== 0) throw new Error('The temporary Codex credential copy is not private');
    for (const [index, name] of fixtures.entries()) {
      await writeFile(path.join(workspace, name), `M0 fixture marker ${String.fromCharCode(65 + index)}\n`, { mode: 0o600 });
    }
  } catch (error) {
    authBytes?.fill(0);
    await rm(fixtureRoot, { recursive: true, force: true });
    throw error;
  }

  const report = {
    schemaVersion: 1,
    codexVersion: version.stdout.trim().slice(0, 80),
    fixtureOnly: true,
    goalBudget: GOAL_BUDGET,
    maxGoalTurns: MAX_TURNS,
    steps: {},
    turns: [],
    limitations: [],
    phase: 'profile-created'
  };
  let server = createClient({ cwd: workspace, codexHome });
  let threadId = null;
  let forkId = null;
  let settled = false;
  let preserveFixtureRoot = false;
  let sourceGoalCleared = false;
  let forkGoalCleared = false;
  let archiveIds = [];

  try {
    report.phase = 'app-server-initialize';
    const initialized = await server.start();
    report.appServerVersion = typeof initialized?.userAgent === 'string'
      ? initialized.userAgent.replace(/[^a-zA-Z0-9._/-]/g, '').slice(0, 100)
      : null;

    report.phase = 'thread-start';
    const started = await server.request('thread/start', {
      cwd: workspace,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'read-only'
    });
    threadId = started?.thread?.id;
    if (typeof threadId !== 'string' || !threadId) throw new Error('App Server did not return the probe thread ID');
    report.thread = { created: true };

    report.phase = 'goal-set';
    await server.request('thread/name/set', { threadId, name: `Totem M0 Goal Probe ${new Date().toISOString()}` });

    report.phase = 'control-turn';
    const controlTurn = await startTurn(server, {
      threadId,
      cwd: workspace,
      prompt: '校驗 probe 的獨立續接：本回合只讀 stage-a.txt 並回報 marker A。不要讀其他檔案，也不要改檔。'
    });
    report.turns.push({
      kind: 'explicit-control-turn',
      status: controlTurn.params?.turn?.status ?? null
    });
    const controlTurnId = turnIdOf(controlTurn);
    if (typeof controlTurnId !== 'string') throw new Error('Control turn did not return a stable turn ID');

    const threadRead = await server.request('thread/read', { threadId, includeTurns: false });
    report.steps.metadata = safeThreadMetadata(threadRead?.thread);
    const sourceKind = threadRead?.thread?.source ?? 'appServer';
    const listing = await server.request('thread/list', {
      cwd: workspace,
      sourceKinds: [sourceKind],
      archived: false,
      useStateDbOnly: true,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      limit: 10
    });
    report.steps.scopedListFoundCreatedThread = Array.isArray(listing?.data)
      && listing.data.some(thread => thread.id === threadId);

    const secondServer = createClient({ cwd: workspace, codexHome });
    try {
      await secondServer.start();
      const independentList = await secondServer.request('thread/list', {
        cwd: workspace,
        sourceKinds: [sourceKind],
        archived: false,
        useStateDbOnly: true,
        limit: 10
      });
      const independentThread = await secondServer.request('thread/read', { threadId, includeTurns: false });
      report.steps.secondAppServer = {
        scopedListFoundCreatedThread: Array.isArray(independentList?.data)
          && independentList.data.some(thread => thread.id === threadId),
        metadata: safeThreadMetadata(independentThread?.thread)
      };
    } finally {
      const secondServerClosed = await secondServer.close();
      if (!secondServerClosed || !secondServer.closed) {
        throw new Error('The independent probe App Server did not close; refusing to continue on the shared disposable profile.');
      }
    }

    const turnsBeforeGoalSet = turnsStarted(server.events, threadId).length;
    const completionsBeforeGoalSet = turnCompletions(server.events, threadId).length;
    report.phase = 'goal-set';
    const goalSet = await server.request('thread/goal/set', {
      threadId,
      objective: '隔離的 workspace 中有 stage-a.txt 至 stage-e.txt。每個 assistant turn 最多只能讀一個 stage 檔案；每輪讀完一個檔案後，只回報該檔案的 marker 並停止本輪。後續 turn 才能讀下一個檔案。只有在至少五個不同 turn 分別讀取五個不同 stage 檔案、比較五個 marker 並確認沒有修改檔案時，目標才算完成。',
      status: 'active',
      tokenBudget: GOAL_BUDGET
    });
    report.steps.goalSet = safeGoal(goalSet?.goal);

    const statusOnlyBefore = turnsStarted(server.events, threadId).length;
    const firstRead = await server.request('thread/goal/get', { threadId });
    report.steps.statusReadOpenedTurn = turnsStarted(server.events, threadId).length !== statusOnlyBefore;
    report.steps.goalAfterRead = safeGoal(firstRead?.goal);

    report.phase = 'observe-goal-set-start';
    const firstAutoStart = await new Promise(resolve => {
      const end = Date.now() + 8_000;
      const timer = setInterval(() => {
        if (turnsStarted(server.events, threadId).length > turnsBeforeGoalSet) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() >= end) {
          clearInterval(timer);
          resolve(false);
        }
      }, 50);
    });
    report.steps.goalSetStartedFirstTurn = firstAutoStart;

    let goalStartSeen = firstAutoStart;
    if (firstAutoStart) {
      const firstGoalStart = turnsStarted(server.events, threadId).find((event, index) => index >= turnsBeforeGoalSet);
      const firstGoalTurnId = turnIdOf(firstGoalStart);
      if (typeof firstGoalTurnId === 'string') {
        report.phase = 'deferred-fork';
        const forked = await server.request('thread/fork', {
          threadId,
          lastTurnId: controlTurnId,
          deferGoalContinuation: true,
          excludeTurns: true
        });
        forkId = forked?.thread?.id;
        if (typeof forkId !== 'string' || !forkId || forkId === threadId) {
          throw new Error('App Server did not return a distinct deferred fork');
        }
        const forkGoal = await server.request('thread/goal/get', { threadId: forkId });
        const forkStartsBefore = turnsStarted(server.events, forkId).length;
        await new Promise(resolve => setTimeout(resolve, 2_000));
        report.steps.deferredFork = {
          idDiffersFromSource: forkId !== threadId,
          sourceTurnAnchor: true,
          goal: safeGoal(forkGoal?.goal),
          startedTurnWithoutExplicitTurnStart: turnsStarted(server.events, forkId).length > forkStartsBefore
        };

        const forkGoalBeforeNoTool = await server.request('thread/goal/get', { threadId: forkId });
        if (forkGoalBeforeNoTool?.goal?.status === 'active'
            && !report.steps.deferredFork.startedTurnWithoutExplicitTurnStart) {
          const forkStartsBeforeExplicit = turnsStarted(server.events, forkId).length;
          const forkCompletionsBeforeExplicit = turnCompletions(server.events, forkId).length;
          const forkTurnResult = await server.request('turn/start', {
            threadId: forkId,
            input: [{ type: 'text', text: 'M0 no-tool suppression check: do not use any tool and do not inspect any file. Reply with the exact text "M0 no-tool turn" and stop. This message alone does not satisfy the active Goal.' }],
            cwd: workspace,
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            sandboxPolicy: { type: 'readOnly' }
          });
          const forkTurnId = forkTurnResult?.turn?.id;
          const noToolCompletion = await waitUntil(() => turnCompletions(server.events, forkId)
            .find(event => turnIdOf(event) === forkTurnId), TURN_TIMEOUT_MS, 'no-tool fork turn completion');
          const forkToolTypes = server.events.filter(event => event.method === 'item/started'
            && event.params?.threadId === forkId && event.params?.turnId === forkTurnId)
            .map(event => event.params?.item?.type).filter(type => typeof type === 'string'
              && !['userMessage', 'agentMessage'].includes(type));
          const followupStart = await new Promise(resolve => {
            const end = Date.now() + CONTINUATION_OBSERVE_MS;
            const timer = setInterval(() => {
              const next = turnsStarted(server.events, forkId)[forkStartsBeforeExplicit + 1];
              if (next) { clearInterval(timer); resolve(next); }
              else if (Date.now() >= end) { clearInterval(timer); resolve(null); }
            }, 50);
          });
          const forkGoalAfterNoTool = await server.request('thread/goal/get', { threadId: forkId });
          const noToolEvidence = {
            completedTurn: noToolCompletion?.params?.turn?.status === 'completed',
            toolItemTypes: forkToolTypes,
            noToolTurnConfirmed: forkToolTypes.length === 0,
            goalStatusAfterTurn: forkGoalAfterNoTool?.goal?.status ?? null,
            autoFollowupStarted: Boolean(followupStart),
            startsBeforeExplicit: forkStartsBeforeExplicit,
            completionsBeforeExplicit: forkCompletionsBeforeExplicit
          };
          if (followupStart) {
            const followupId = turnIdOf(followupStart);
            const steered = await server.request('turn/steer', {
              threadId: forkId,
              expectedTurnId: followupId,
              input: [{ type: 'text', text: '這個自動續接回合也不得呼叫任何工具，只回覆「M0 automatic no-tool continuation」並停止。這句回覆不滿足 Goal。' }]
            });
            noToolEvidence.steerAccepted = steered?.turnId === followupId;
            const followupCompletion = await waitUntil(() => turnCompletions(server.events, forkId)
              .find(event => turnIdOf(event) === followupId), TURN_TIMEOUT_MS, 'steered automatic Goal turn completion');
            const followupToolTypes = server.events.filter(event => event.method === 'item/started'
              && event.params?.threadId === forkId && event.params?.turnId === followupId)
              .map(event => event.params?.item?.type).filter(type => typeof type === 'string'
                && !['userMessage', 'agentMessage'].includes(type));
            const noToolFollowupStartCount = turnsStarted(server.events, forkId).length;
            const nextFollowup = await new Promise(resolve => {
              const end = Date.now() + CONTINUATION_OBSERVE_MS;
              const timer = setInterval(() => {
                const next = turnsStarted(server.events, forkId)[noToolFollowupStartCount];
                if (next) { clearInterval(timer); resolve(next); }
                else if (Date.now() >= end) { clearInterval(timer); resolve(null); }
              }, 50);
            });
            const finalForkGoal = await server.request('thread/goal/get', { threadId: forkId });
            noToolEvidence.automaticTurnStatus = followupCompletion.params?.turn?.status ?? null;
            noToolEvidence.automaticTurnToolItemTypes = followupToolTypes;
            noToolEvidence.automaticTurnWasToolless = followupToolTypes.length === 0;
            noToolEvidence.followupAfterToollessAutomaticTurn = Boolean(nextFollowup);
            noToolEvidence.goalStatusAfterAutomaticTurn = finalForkGoal?.goal?.status ?? null;
            noToolEvidence.noToolSuppressedWhileGoalActive = followupToolTypes.length === 0
              && finalForkGoal?.goal?.status === 'active' && !nextFollowup;
            if (nextFollowup || finalForkGoal?.goal?.status === 'active') {
              const stopped = await pauseAndInterruptInFlightTurn(server, forkId);
              noToolEvidence.goalPausedAfterProbe = stopped.goalStatus === 'paused';
              noToolEvidence.noInFlightTurnAfterProbe = stopped.noInFlightTurn;
            }
          }
          report.steps.noToolSuppression = noToolEvidence;
        } else {
          report.steps.noToolSuppression = {
            skipped: 'Deferred fork did not preserve an active Goal without starting its own turn.'
          };
        }
      } else report.steps.deferredFork = { skipped: 'Goal activation did not emit a turn/started event.' };
    } else report.steps.deferredFork = { skipped: 'Goal activation did not start a turn.' };

    let autoTurnCount = 0;
    let completionCountBefore = completionsBeforeGoalSet;
    let sourceGoal = null;
    let sourceTurnBoundReached = false;
    for (; autoTurnCount < MAX_TURNS; autoTurnCount++) {
      let startedEvent;
      if (autoTurnCount === 0 && goalStartSeen) {
        startedEvent = turnsStarted(server.events, threadId).find((event, index) => index >= turnsBeforeGoalSet);
      } else {
        report.phase = 'observe-auto-continuation';
        startedEvent = await new Promise(resolve => {
          const end = Date.now() + CONTINUATION_OBSERVE_MS;
          const baseline = turnsBeforeGoalSet + autoTurnCount;
          const timer = setInterval(() => {
            const next = turnsStarted(server.events, threadId)[baseline];
            const currentCompletions = turnCompletions(server.events, threadId).length;
            if (next) { clearInterval(timer); resolve(next); }
            else if (currentCompletions >= completionCountBefore && Date.now() >= end) {
              clearInterval(timer);
              resolve(null);
            }
          }, 50);
        });
      }
      if (!startedEvent) break;
      goalStartSeen = true;
      const activeTurnId = turnIdOf(startedEvent);
      if (autoTurnCount === MAX_TURNS - 1) {
        sourceTurnBoundReached = true;
        report.phase = 'enforce-goal-turn-bound';
        const stopped = await pauseAndInterruptInFlightTurn(server, threadId);
        const completion = turnCompletions(server.events, threadId)
          .find(event => turnIdOf(event) === activeTurnId);
        if (!completion) throw new Error('The Goal turn probe bound could not be enforced safely');
        report.turns.push({ kind: 'goal-turn-boundary', status: completion.params?.turn?.status ?? null });
        report.steps.turnBound = {
          maxGoalTurns: MAX_TURNS,
          stopRequestedOnFinalAllowedStart: true,
          finalTurnStatus: completion.params?.turn?.status ?? null,
          goalStatusAfterStop: stopped.goalStatus,
          interruptedTurn: stopped.interruptedTurn,
          noInFlightTurn: stopped.noInFlightTurn
        };
        if (!stopped.noInFlightTurn || turnsStarted(server.events, threadId).length - turnsBeforeGoalSet > MAX_TURNS) {
          throw new Error('The Goal probe continued beyond its enforced turn bound');
        }
        sourceGoal = await server.request('thread/goal/get', { threadId });
        break;
      }
      report.phase = `goal-turn-${autoTurnCount + 1}-completion`;
      const completion = await waitUntil(() => turnCompletions(server.events, threadId)
        .find(event => turnIdOf(event) === activeTurnId), TURN_TIMEOUT_MS, 'active Goal turn completion');
      completionCountBefore = turnCompletions(server.events, threadId).length;
      report.turns.push({ kind: 'goal-turn', status: completion.params?.turn?.status ?? null });
      sourceGoal = await server.request('thread/goal/get', { threadId });
      if (sourceGoal?.goal?.status !== 'active') break;
    }
    report.steps.goalTurnsObserved = turnsStarted(server.events, threadId).length - turnsBeforeGoalSet;
    report.steps.goalAfterObservedTurns = safeGoal(sourceGoal?.goal ?? (await server.request('thread/goal/get', { threadId }))?.goal);
    report.steps.appServerAutoContinuationObserved = report.steps.goalTurnsObserved > 1;
    report.steps.activeGoalHadNoFollowupWithinWindow = report.steps.goalAfterObservedTurns?.status === 'active'
      && autoTurnCount > 0 && autoTurnCount < MAX_TURNS;

    let startedGoalTurnIds = turnsStarted(server.events, threadId)
      .slice(turnsBeforeGoalSet).map(turnIdOf).filter(Boolean);
    const allCompletions = turnCompletions(server.events, threadId);
    const firstGoalTurn = allCompletions.find(event => turnIdOf(event) === startedGoalTurnIds[0]);
    const firstGoalStatus = firstGoalTurn?.params?.turn?.status ?? null;
    if (!sourceTurnBoundReached && (report.steps.goalAfterObservedTurns?.status === 'active'
        || report.steps.goalAfterObservedTurns?.status === 'budgetLimited')) {
      const beforePause = await server.request('thread/goal/get', { threadId });
      await server.request('thread/goal/set', { threadId, status: 'paused' });
      const paused = await server.request('thread/goal/get', { threadId });
      report.steps.pause = {
        fromStatus: sourceGoal?.goal?.status ?? null,
        status: paused?.goal?.status ?? null,
        usageUnchanged: Number(paused?.goal?.tokensUsed) === Number(beforePause?.goal?.tokensUsed),
        budgetUnchanged: (paused?.goal?.tokenBudget ?? null) === (beforePause?.goal?.tokenBudget ?? null)
      };
      const revisedBudget = (Number.isSafeInteger(paused?.goal?.tokenBudget) ? paused.goal.tokenBudget : GOAL_BUDGET) + 1000;
      const testBudget = paused?.goal?.status === 'paused' && paused.goal.tokensUsed >= revisedBudget
        ? paused.goal.tokensUsed + 10_000 : revisedBudget;
      const startsBeforeBudgetUpdate = turnsStarted(server.events, threadId).length;
      await server.request('thread/goal/set', { threadId, tokenBudget: testBudget });
      const budgetChanged = await server.request('thread/goal/get', { threadId });
      const budgetTriggeredStart = await new Promise(resolve => {
        const end = Date.now() + CONTINUATION_OBSERVE_MS;
        const timer = setInterval(() => {
          const next = turnsStarted(server.events, threadId)[startsBeforeBudgetUpdate];
          if (next) { clearInterval(timer); resolve(next); }
          else if (Date.now() >= end) { clearInterval(timer); resolve(null); }
        }, 50);
      });
      report.steps.budgetUpdate = {
        valueAccepted: budgetChanged?.goal?.tokenBudget === testBudget,
        usageUnchanged: Number(budgetChanged?.goal?.tokensUsed) === Number(paused?.goal?.tokensUsed),
        statusAfterUpdate: budgetChanged?.goal?.status ?? null,
        startedTurnWithoutAnotherActivationRequest: Boolean(budgetTriggeredStart)
      };
      let resumedStart = budgetTriggeredStart;
      let activationCause = budgetTriggeredStart ? 'budget-update' : null;
      if (!resumedStart && budgetChanged?.goal?.status !== 'active') {
        report.steps.resume = {
          status: budgetChanged?.goal?.status ?? null,
          startedTurnWithoutExplicitTurnStart: false,
          skipped: 'Budget update did not activate the Goal; do not issue a second mutation from an unverified state.'
        };
      } else if (!resumedStart) {
        const startsBeforeResume = turnsStarted(server.events, threadId).length;
        await server.request('thread/goal/set', { threadId, status: 'active' });
        resumedStart = await new Promise(resolve => {
          const end = Date.now() + CONTINUATION_OBSERVE_MS;
          const timer = setInterval(() => {
            const next = turnsStarted(server.events, threadId)[startsBeforeResume];
            if (next) { clearInterval(timer); resolve(next); }
            else if (Date.now() >= end) { clearInterval(timer); resolve(null); }
          }, 50);
        });
        activationCause = resumedStart ? 'explicit-active-after-observation-window' : null;
      }
      const resumeReadback = await server.request('thread/goal/get', { threadId });
      report.steps.resume = {
        ...report.steps.resume,
        status: resumeReadback?.goal?.status ?? null,
        startedTurnWithoutExplicitTurnStart: Boolean(resumedStart),
        activationCause
      };
      if (resumedStart) {
        const resumed = await waitUntil(() => turnCompletions(server.events, threadId)
          .find(event => turnIdOf(event) === turnIdOf(resumedStart)), TURN_TIMEOUT_MS, 'resumed Goal turn completion');
        report.turns.push({ kind: 'goal-resume-turn', status: resumed.params?.turn?.status ?? null });
      }
      const startsBeforeFreshRecovery = Math.max(0,
        turnsStarted(server.events, threadId).length - turnsBeforeGoalSet);
      const completionsBeforeFreshRecovery = Math.max(0,
        turnCompletions(server.events, threadId).length - completionsBeforeGoalSet);
      const recoveryCandidate = await server.request('thread/goal/get', { threadId });
      if (!resumedStart && recoveryCandidate?.goal?.status === 'budgetLimited'
          && startsBeforeFreshRecovery < MAX_TURNS - 1) {
        report.phase = 'fresh-app-server-goal-recovery';
        const oldServerClosed = await server.close();
        if (!oldServerClosed || !server.closed) {
          throw new Error('The prior probe App Server did not close; refusing to overlap processes on the disposable profile.');
        }
        server = createClient({ cwd: workspace, codexHome });
        await server.start();
        const startsBeforeExactResume = turnsStarted(server.events, threadId).length;
        const completionsBeforeExactResume = turnCompletions(server.events, threadId).length;
        const exactResume = await server.request('thread/resume', threadResumeParams({
          threadId, workspace, readOnly: true, excludeTurns: true
        }));
        const exactThread = exactResume?.thread?.id === threadId;
        let recovered = await server.request('thread/goal/get', { threadId });
        const beforeRecovery = recovered?.goal ?? null;
        const freshRecovery = {
          attempted: true,
          exactThread,
          statusBefore: beforeRecovery?.status ?? null,
          eventStartBaseline: startsBeforeExactResume,
          eventCompletionBaseline: completionsBeforeExactResume,
          budgetMutation: { attempted: false },
          activation: { attempted: false }
        };
        if (exactThread && beforeRecovery?.status === 'budgetLimited'
            && Number.isSafeInteger(beforeRecovery.tokenBudget) && Number.isSafeInteger(beforeRecovery.tokensUsed)) {
          const recoveryBudget = Math.max(beforeRecovery.tokenBudget + 1000, beforeRecovery.tokensUsed + 1000);
          const startsBeforeBudgetMutation = turnsStarted(server.events, threadId).length;
          await server.request('thread/goal/set', { threadId, tokenBudget: recoveryBudget });
          recovered = await server.request('thread/goal/get', { threadId });
          let afterBudget = recovered?.goal ?? null;
          const budgetAccepted = afterBudget?.tokenBudget === recoveryBudget;
          const usagePreservedOrAdvanced = Number.isSafeInteger(afterBudget?.tokensUsed)
            && afterBudget.tokensUsed >= beforeRecovery.tokensUsed;
          const objectivePreserved = afterBudget?.objective === beforeRecovery.objective;
          const timePreservedOrAdvanced = Number.isSafeInteger(afterBudget?.timeUsedSeconds)
            && afterBudget.timeUsedSeconds >= beforeRecovery.timeUsedSeconds;
          const creationIdentityPreserved = afterBudget?.createdAt === beforeRecovery.createdAt;
          const budgetReadbackValid = budgetAccepted && usagePreservedOrAdvanced && objectivePreserved
            && timePreservedOrAdvanced && creationIdentityPreserved;
          freshRecovery.budgetMutation = {
            attempted: true,
            accepted: budgetAccepted,
            status: afterBudget?.status ?? null,
            usagePreservedOrAdvanced,
            objectivePreserved,
            timePreservedOrAdvanced,
            creationIdentityPreserved,
            readbackValid: budgetReadbackValid
          };
          if (afterBudget?.status === 'active') {
            freshRecovery.activation.implicitActivationAfterBudgetWrite = true;
            const safetyStop = await pauseAndInterruptInFlightTurn(server, threadId);
            freshRecovery.activation.safetyStoppedImplicitActivation = safetyStop.noInFlightTurn
              && safetyStop.goalStatus === 'paused';
            afterBudget = (await server.request('thread/goal/get', { threadId }))?.goal ?? null;
          } else if (budgetReadbackValid && afterBudget?.status === 'budgetLimited') {
            freshRecovery.activation.attempted = true;
            await server.request('thread/goal/set', { threadId, status: 'active' });
            recovered = await server.request('thread/goal/get', { threadId });
            afterBudget = recovered?.goal ?? null;
          }
          freshRecovery.activation.status = afterBudget?.status ?? null;
          freshRecovery.activation.budgetMutationStartedTurn = turnsStarted(server.events, threadId).length > startsBeforeBudgetMutation;
          let recoveryStart = turnsStarted(server.events, threadId)[startsBeforeExactResume] ?? null;
          if (afterBudget?.status === 'active' && !recoveryStart) {
            recoveryStart = await new Promise(resolve => {
              const baseline = turnsStarted(server.events, threadId).length;
              const end = Date.now() + CONTINUATION_OBSERVE_MS;
              const timer = setInterval(() => {
                const next = turnsStarted(server.events, threadId)[baseline];
                if (next) { clearInterval(timer); resolve(next); }
                else if (Date.now() >= end) { clearInterval(timer); resolve(null); }
              }, 50);
            });
          }
          if (recoveryStart) {
            const recoveryTurnId = turnIdOf(recoveryStart);
            const completion = await waitUntil(() => turnCompletions(server.events, threadId)
              .find(event => turnIdOf(event) === recoveryTurnId), TURN_TIMEOUT_MS, 'fresh-process recovery turn completion');
            report.turns.push({ kind: 'fresh-process-recovery-turn', status: completion.params?.turn?.status ?? null });
            const nextStart = await new Promise(resolve => {
              const baseline = turnsStarted(server.events, threadId).length;
              const end = Date.now() + CONTINUATION_OBSERVE_MS;
              const timer = setInterval(() => {
                const next = turnsStarted(server.events, threadId)[baseline];
                if (next) { clearInterval(timer); resolve(next); }
                else if (Date.now() >= end) { clearInterval(timer); resolve(null); }
              }, 50);
            });
            if (nextStart) {
              const stopped = await pauseAndInterruptInFlightTurn(server, threadId);
              freshRecovery.activation.continuationStopped = stopped.noInFlightTurn;
            }
          }
          let afterRecovery = (await server.request('thread/goal/get', { threadId }))?.goal;
          if (afterRecovery?.status === 'active') {
            const stopped = await pauseAndInterruptInFlightTurn(server, threadId);
            afterRecovery = (await server.request('thread/goal/get', { threadId }))?.goal;
            freshRecovery.activation.cleanupPausedActiveGoal = stopped.noInFlightTurn
              && afterRecovery?.status === 'paused';
          }
          freshRecovery.activation.turnStarted = turnsStarted(server.events, threadId).length > startsBeforeExactResume;
          freshRecovery.activation.turnCountWithinBound = startsBeforeFreshRecovery
            + Math.max(0, turnsStarted(server.events, threadId).length - startsBeforeExactResume) <= MAX_TURNS;
          freshRecovery.activation.usageDidNotReset = Number.isSafeInteger(afterRecovery?.tokensUsed)
            && afterRecovery.tokensUsed >= beforeRecovery.tokensUsed;
          freshRecovery.activation.threadIdPreserved = afterRecovery?.threadId === threadId;
          freshRecovery.activation.statusAfterProbe = afterRecovery?.status ?? null;
        }
        report.steps.freshProcessRecovery = freshRecovery;
        report.steps.goalTurnsObserved = startsBeforeFreshRecovery
          + Math.max(0, turnsStarted(server.events, threadId).length - startsBeforeExactResume);
        report.steps.completedTurns = completionsBeforeFreshRecovery
          + Math.max(0, turnCompletions(server.events, threadId).length - completionsBeforeExactResume);
        report.steps.goalTurnsWithinProbeBound = report.steps.goalTurnsObserved <= MAX_TURNS
          && (freshRecovery.activation.continuationStopped ?? true);
      } else {
        report.steps.freshProcessRecovery = {
          attempted: false,
          reason: recoveryCandidate?.goal?.status !== 'budgetLimited'
            ? `native Goal status was ${recoveryCandidate?.goal?.status ?? 'unavailable'}`
            : 'remaining Goal turn allowance reserves one start for bounded cleanup'
        };
      }
    } else if (sourceTurnBoundReached) {
      report.steps.pause = { status: report.steps.turnBound?.goalStatusAfterStop ?? null, performedAtProbeBound: true };
      report.steps.budgetUpdate = { skipped: 'The hard probe turn bound was reached; no further source mutation was attempted.' };
      report.steps.resume = { skipped: 'The hard probe turn bound was reached; no further source mutation was attempted.' };
    } else {
      report.steps.pause = { skipped: `The native Goal was already ${report.steps.goalAfterObservedTurns?.status ?? 'unavailable'}.` };
      report.steps.budgetUpdate = { skipped: `The native Goal was already ${report.steps.goalAfterObservedTurns?.status ?? 'unavailable'}.` };
      report.steps.resume = { skipped: `The native Goal was already ${report.steps.goalAfterObservedTurns?.status ?? 'unavailable'}.` };
    }

    const finalServerGoalStartBaseline = report.steps.freshProcessRecovery?.attempted
      ? report.steps.freshProcessRecovery.eventStartBaseline : turnsBeforeGoalSet;
    const finalServerGoalCompletionBaseline = report.steps.freshProcessRecovery?.attempted
      ? report.steps.freshProcessRecovery.eventCompletionBaseline : completionsBeforeGoalSet;
    startedGoalTurnIds = turnsStarted(server.events, threadId).slice(finalServerGoalStartBaseline).map(turnIdOf).filter(Boolean);

    const fixtureTexts = await Promise.all(fixtures.map(name => readFile(path.join(workspace, name), 'utf8')));
    report.steps.fixtureFilesUnchanged = fixtureTexts.every((value, index) => value === `M0 fixture marker ${String.fromCharCode(65 + index)}\n`);
    if (!report.steps.freshProcessRecovery?.attempted) {
      report.steps.completedTurns = Math.max(0,
        turnCompletions(server.events, threadId).length - finalServerGoalCompletionBaseline);
    }
    report.steps.startedTurnIdsBelongToThread = turnsStarted(server.events, threadId).every(event =>
      event.params?.threadId === threadId || event.params?.turn?.threadId === threadId);
    report.steps.firstGoalTurnStatus = firstGoalStatus;
    report.steps.goalTurnsWithinProbeBound = (report.steps.goalTurnsObserved ?? startedGoalTurnIds.length) <= MAX_TURNS
      && (report.steps.turnBound?.noInFlightTurn ?? true);

    const listingAfterTurns = await server.request('thread/list', {
      cwd: workspace,
      sourceKinds: [sourceKind],
      archived: false,
      useStateDbOnly: true,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      limit: 10
    });
    report.steps.scopedListAfterTurnsFoundCreatedThread = Array.isArray(listingAfterTurns?.data)
      && listingAfterTurns.data.some(thread => thread.id === threadId);
    report.steps.provenance = safeThreadMetadata(listingAfterTurns?.data?.find(thread => thread.id === threadId));

    if (!report.steps.fixtureFilesUnchanged) throw new Error('The probe fixture changed unexpectedly');

    const sourceGoalForCleanup = await server.request('thread/goal/get', { threadId });
    report.phase = 'clear-test-goals';
    if (sourceGoalForCleanup?.goal) {
      if (!await clearProbeGoalSafely(server, threadId)) throw new Error('Source fixture Goal remained after clear');
      sourceGoalCleared = true;
      report.steps.sourceGoalCleared = true;
    } else {
      sourceGoalCleared = true;
      report.steps.sourceGoalCleared = true;
    }
    if (forkId) {
      const forkGoal = await server.request('thread/goal/get', { threadId: forkId });
      if (forkGoal?.goal && !await clearProbeGoalSafely(server, forkId)) throw new Error('Fork fixture Goal remained after clear');
      forkGoalCleared = true;
      report.steps.forkGoalCleared = true;
    }

    for (const id of [threadId, forkId].filter(Boolean)) {
      try { await server.request('thread/archive', { threadId: id }); archiveIds.push(id); }
      catch { report.limitations.push('A probe-only thread could not be archived by this App Server.'); }
    }
    report.steps.archivedProbeThreads = archiveIds.length;
    report.steps.explicitControlTurnCompletedBeforeGoal = controlTurn.params?.turn?.status === 'completed';
    report.steps.atLeastTwoGoalTurnsObserved = (report.steps.goalTurnsObserved ?? startedGoalTurnIds.length) >= 2;
    report.eventSequence = safeEventSequence(server.events).events;
    report.omittedEventCount = safeEventSequence(server.events).omittedEventCount;
    report.nextAction = report.steps.atLeastTwoGoalTurnsObserved
      ? 'Native Goal continuation was observed; keep one continuation owner in the shared runtime and finish M0 event-suppression coverage.'
      : report.steps.goalAfterObservedTurns?.status === 'complete'
        ? 'The active Goal completed within one observed Goal turn; the test did not establish multi-turn continuation or suppression behavior.'
        : 'An active Goal remained without an observed follow-up in the probe window; confirm documented continuation ownership before M0 is complete.';

    const finalCloseConfirmed = await server.close();
    if (!finalCloseConfirmed || !server.closed) {
      throw new Error('Final probe App Server close was not confirmed; disposable fixture must be preserved for recovery.');
    }
    settled = true;
    report.phase = 'complete';
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    error.probeEvidence = {
      phase: report.phase,
      steps: report.steps,
      observedEvents: safeEventSequence(server.events)
    };
    throw error;
  } finally {
    if (!settled && threadId && !server.closed) {
      try {
        const goal = await server.request('thread/goal/get', { threadId }, 3_000);
        if (goal?.goal) await clearProbeGoalSafely(server, threadId);
        sourceGoalCleared = true;
      } catch {}
    }
    if (!settled && forkId && !server.closed) {
      try {
        const goal = await server.request('thread/goal/get', { threadId: forkId }, 3_000);
        if (goal?.goal) await clearProbeGoalSafely(server, forkId);
        forkGoalCleared = true;
      } catch {}
    }
    const finalCloseConfirmed = await server.close();
    if (!finalCloseConfirmed || !server.closed) {
      preserveFixtureRoot = true;
      console.error(JSON.stringify({ recoveryRequired: true,
        retainedFixtureRoot: fixtureRoot,
        message: 'App Server close was not confirmed; temporary profile/workspace was preserved for manual recovery.' }));
    }
    if (!preserveFixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
    if (!settled && (!sourceGoalCleared || (forkId && !forkGoalCleared))) {
      console.error('Probe did not settle; a test-only Goal may need manual recovery.');
    }
  }
}

run().catch(error => {
    const output = { error: error.message, rpcCode: error.code ?? null,
      diagnostic: error.message.includes('diagnostic=other-stderr') ? safeDiagnostic(error.stderrTail ?? '') : undefined };
  output.probeEvidence = error.probeEvidence;
  console.error(JSON.stringify(output));
  process.exitCode = 1;
});
