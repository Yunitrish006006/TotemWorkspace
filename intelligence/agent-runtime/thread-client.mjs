import { spawn } from 'node:child_process';

const READ_METHODS = new Set([
  'thread/list', 'thread/read', 'thread/turns/list', 'thread/items/list'
]);
const GOAL_METHODS = new Set(['thread/goal/get', 'thread/goal/set', 'thread/goal/clear']);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BUFFER_BYTES = MAX_RESPONSE_BYTES + 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

function createRpcClient({ send, closeTransport = async () => {}, timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES, initialRequestId = 1, allowedMethods, name = 'thread history' } = {}) {
  if (typeof send !== 'function') throw new TypeError('send is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new RangeError('timeoutMs must be between 1 and 15000');
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) {
    throw new RangeError('maxResponseBytes must be between 1 and 2097152');
  }
  if (!Number.isSafeInteger(initialRequestId) || initialRequestId < 1) throw new RangeError('initialRequestId must be a positive safe integer');
  let nextId = initialRequestId;
  let closed = false;
  let transportClosed = false;
  const pending = new Map();

  function failAll(code = 'THREAD_CLIENT_CLOSED') {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(Object.assign(new Error(`Codex ${name} RPC unavailable`), { code }));
    }
    pending.clear();
  }

  function receive(frame) {
    if (closed) return;
    let message;
    try {
      const size = Buffer.byteLength(typeof frame === 'string' ? frame : JSON.stringify(frame));
      if (size > maxResponseBytes) throw Object.assign(new Error(), { code: 'THREAD_RESPONSE_TOO_LARGE' });
      message = typeof frame === 'string' ? JSON.parse(frame) : frame;
    } catch (error) {
      failAll(error.code ?? 'THREAD_MALFORMED_FRAME');
      return;
    }
    if (!message || !Object.hasOwn(message, 'id')) return;
    const request = pending.get(String(message.id));
    if (!request) return;
    pending.delete(String(message.id));
    clearTimeout(request.timer);
    if (message.error) {
      const errorText = String(message.error.message ?? '').toLowerCase();
      const rpcErrorKind = /unknown method|method not found|unsupported/.test(errorText) ? 'unsupported-method'
        : /invalid params|invalid request/.test(errorText) ? 'invalid-request-or-params'
          : /not found|unknown thread/.test(errorText) ? 'thread-not-found' : 'other';
      request.reject(Object.assign(new Error('Thread history RPC failed'), {
        code: 'THREAD_RPC_ERROR', rpcCode: Number.isInteger(message.error.code) ? message.error.code : null,
        rpcMethod: request.method, rpcErrorKind
      }));
    }
    else request.resolve(message.result);
  }

  function request(method, params = {}) {
    if (!allowedMethods.has(method)) return Promise.reject(Object.assign(new Error(`Unsupported Codex ${name} method`), { code: 'THREAD_METHOD_NOT_ALLOWED' }));
    if (closed) return Promise.reject(Object.assign(new Error(`Codex ${name} RPC unavailable`), { code: 'THREAD_CLIENT_CLOSED' }));
    if (!params || typeof params !== 'object' || Array.isArray(params)) return Promise.reject(new TypeError('params must be an object'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(Object.assign(new Error(`Codex ${name} RPC timed out`), { code: 'THREAD_RPC_TIMEOUT' }));
      }, timeoutMs);
      pending.set(String(id), { resolve, reject, timer, method });
      try { send({ id, method, params }); }
      catch {
        pending.delete(String(id)); clearTimeout(timer);
        reject(Object.assign(new Error(`Codex ${name} RPC unavailable`), { code: 'THREAD_TRANSPORT_ERROR' }));
      }
    });
  }

  return {
    request,
    receive,
    listThreads: params => request('thread/list', params),
    readThread: params => request('thread/read', params),
    listTurns: params => request('thread/turns/list', params),
    listItems: params => request('thread/items/list', params),
    fail: failAll,
    get closed() { return closed; },
    async close() {
      failAll();
      if (!transportClosed) {
        transportClosed = true;
        await closeTransport();
      }
    }
  };
}

/** A bounded JSON-RPC client that exposes only read-only thread history calls. */
export function createThreadClient(options = {}) {
  return createRpcClient({ ...options, allowedMethods: READ_METHODS, name: 'thread history' });
}

/** A bounded Goal RPC client with no arbitrary method dispatch. */
export function createGoalClient(options = {}) {
  const rpc = createRpcClient({ ...options, allowedMethods: GOAL_METHODS, name: 'thread Goal' });
  return Object.freeze({ ...rpc,
    getGoal: params => rpc.request('thread/goal/get', params),
    setGoal: params => rpc.request('thread/goal/set', params),
    clearGoal: params => rpc.request('thread/goal/clear', params)
  });
}

function spawnAppServerClient({ codexBin = 'codex', cwd, env = process.env, spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = MAX_RESPONSE_BYTES, createClient, clientInfo } = {}) {
  if (typeof cwd !== 'string' || !cwd) throw new TypeError('cwd is required');
  const child = spawnImpl(codexBin, ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = '';
  let closed = false;
  let failureKillTimer;
  let initializedResolve;
  let initializedReject;
  const initialized = new Promise((resolve, reject) => { initializedResolve = resolve; initializedReject = reject; });
  const rpc = createClient({
    timeoutMs, maxResponseBytes, initialRequestId: 2,
    send(message) { child.stdin.write(`${JSON.stringify(message)}\n`); },
    async closeTransport() {
      if (closed) return;
      child.stdin.end();
      await new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) { closed = true; resolve(); return; }
        const termTimer = setTimeout(() => { if (!closed) child.kill('SIGTERM'); }, 500);
        const killTimer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 2_500);
        child.once('close', () => {
          closed = true;
          clearTimeout(termTimer);
          clearTimeout(killTimer);
          resolve();
        });
      });
    }
  });
  function failTransport(code) {
    rpc.fail(code);
    if (!closed) {
      try { child.kill('SIGTERM'); } catch {}
      failureKillTimer = setTimeout(() => { if (!closed) { try { child.kill('SIGKILL'); } catch {} } }, 2_000);
      failureKillTimer.unref?.();
    }
  }
  child.on('error', () => { clearTimeout(failureKillTimer); failTransport('THREAD_TRANSPORT_ERROR'); initializedReject(new Error('Thread history RPC unavailable')); });
  child.on('close', () => { closed = true; clearTimeout(failureKillTimer); rpc.fail('THREAD_CLIENT_CLOSED'); initializedReject(new Error('Thread history RPC unavailable')); });
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (Buffer.byteLength(line) > MAX_BUFFER_BYTES) { failTransport('THREAD_RESPONSE_TOO_LARGE'); return; }
      let message;
      try { message = JSON.parse(line); }
      catch { failTransport('THREAD_MALFORMED_FRAME'); return; }
      if (message.id === 1 && message.result) { initializedResolve(message.result); continue; }
      rpc.receive(message);
    }
    if (Buffer.byteLength(buffer) > MAX_BUFFER_BYTES) failTransport('THREAD_RESPONSE_TOO_LARGE');
  });
  const start = async () => {
    child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: {
      clientInfo, capabilities: { experimentalApi: true }
    } })}\n`);
    let initializeTimer;
    try {
      await Promise.race([initialized, new Promise((_, reject) => {
        initializeTimer = setTimeout(() => reject(new Error('Thread history initialize timed out')), timeoutMs);
      })]);
    } catch {
      await rpc.close();
      throw new Error('Thread history initialize unavailable');
    } finally {
      clearTimeout(initializeTimer);
    }
    child.stdin.write('{"method":"initialized","params":{}}\n');
    return rpc;
  };
  return { start, ...rpc, close: () => rpc.close() };
}

/** Launch a short-lived Codex App Server process for bounded history access. */
export function spawnThreadClient(options = {}) {
  return spawnAppServerClient({ ...options, createClient: createThreadClient,
    clientInfo: { name: 'totem_discord_thread_history', version: '0.1.0' } });
}

/** Launch a short-lived Codex App Server process for allow-listed Goal RPCs. */
export function spawnGoalClient(options = {}) {
  return spawnAppServerClient({ ...options, createClient: createGoalClient,
    clientInfo: { name: 'totem_discord_thread_goal', version: '0.1.0' } });
}
