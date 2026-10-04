import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { NativeModelRouter } from '../../../intelligence/agent-runtime/native-model-router.mjs';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PENDING = 128;

/** Dedicated stdio backend; client approval replies and notifications pass through unchanged. */
export function attachBackend(socket, { codexBin, cwd, env, serverArgs, knowledge, model, effort, onDecision, spawnImpl = spawn }) {
  const child = spawnImpl(codexBin, ['app-server', '--listen', 'stdio://', ...serverArgs],
    { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0, closed = false, buffer = Buffer.alloc(0), queued = 0;
  let catalogCache = null, catalogAt = 0, catalogPending = null, usage = null;
  const sendClient = message => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BYTES) { close(); return; }
    socket.send(JSON.stringify(message));
  };
  const sendBackend = message => {
    if (closed || child.stdin.destroyed) throw new Error('Codex backend is unavailable');
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > MAX_BYTES || child.stdin.writableLength > MAX_BYTES) throw new Error('Codex transport capacity reached');
    child.stdin.write(line);
  };
  function close() {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject?.(new Error('Codex backend disconnected')); }
    pending.clear();
    socket.close(1011, 'Codex connection closed');
    child.stdin.end();
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000);
    killTimer.unref();
    child.once('exit', () => clearTimeout(killTimer));
  }
  function rpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (pending.size >= MAX_PENDING) { reject(new Error('Router request capacity reached')); return; }
      const id = `totem-router-${++sequence}`;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex catalog request timed out')); }, 15000);
      pending.set(id, { resolve, reject, timer });
      try { sendBackend({ id, method, params }); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  async function catalog() {
    if (catalogCache && Date.now() - catalogAt < 60000) return { models: catalogCache, usage };
    if (!catalogPending) catalogPending = (async () => {
      const models = [], cursors = new Set();
      let cursor = null;
      for (let page = 0; page < 20; page++) {
        const result = await rpc('model/list', { cursor, limit: 100, includeHidden: false });
        if (!Array.isArray(result?.data)) throw new Error('Invalid Codex model catalog');
        models.push(...result.data);
        if (!result.nextCursor) {
          // Quota failure is unknown evidence, not a fabricated budget or a reason to bypass policy.
          try { usage = { ...await rpc('account/rateLimits/read'), checkedAt: Date.now() }; } catch { usage = null; }
          catalogCache = models; catalogAt = Date.now();
          return { models, usage };
        }
        if (typeof result.nextCursor !== 'string' || cursors.has(result.nextCursor)) throw new Error('Invalid Codex catalog cursor');
        cursor = result.nextCursor; cursors.add(cursor);
      }
      throw new Error('Codex model catalog exceeded page limit');
    })().finally(() => { catalogPending = null; });
    return catalogPending;
  }
  const router = new NativeModelRouter({ knowledge, cwd, catalog, model, effort, onDecision });
  function receiveBackend(message) {
    if (message.method === 'account/rateLimits/updated') usage = { ...message.params, checkedAt: Date.now() };
    if (message.method) {
      router.observe(message);
      sendClient(message); // Includes server-originated approval requests with their original IDs.
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return; // Late response to an expired internal request.
    pending.delete(message.id); clearTimeout(entry.timer);
    if (entry.resolve) {
      if (message.error) entry.reject(new Error('Codex catalog request failed'));
      else entry.resolve(message.result);
    } else {
      router.observe(message, entry.request);
      sendClient({ ...message, id: entry.clientId });
    }
  }
  child.stdout.on('data', chunk => {
    if (buffer.length + chunk.length > MAX_BYTES) { close(); return; }
    buffer = Buffer.concat([buffer, chunk]);
    let boundary;
    while ((boundary = buffer.indexOf(10)) !== -1) {
      const line = buffer.subarray(0, boundary); buffer = buffer.subarray(boundary + 1);
      if (!line.length) continue;
      try { receiveBackend(JSON.parse(line.toString('utf8'))); } catch { close(); return; }
    }
  });
  // Drain, but never echo backend stderr: it may contain prompts, paths or credentials.
  child.stderr.resume();
  child.on('error', close); child.on('exit', close); child.stdin.on('error', close);
  socket.on('close', close); socket.on('error', close);
  let turns = Promise.resolve();
  socket.on('message', (data, binary) => {
    let message;
    try {
      if (binary) throw new Error('Text messages required');
      message = JSON.parse(data.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid RPC message');
    } catch { socket.close(1008, 'Invalid RPC message'); return; }
    const hasId = Object.hasOwn(message, 'id');
    if (hasId && !['string', 'number'].includes(typeof message.id)) { socket.close(1008, 'Invalid RPC ID'); return; }
    const forward = async () => {
      try {
        const routed = await router.route(message);
        if (message.method && hasId) {
          if (pending.size >= MAX_PENDING) throw new Error('Router request capacity reached');
          const id = `totem-client-${++sequence}`;
          pending.set(id, { clientId: message.id, request: routed });
          try { sendBackend({ ...routed, id }); } catch (error) { pending.delete(id); throw error; }
        } else sendBackend(routed);
      } catch {
        if (hasId && message.method) sendClient({ id: message.id, error: { code: -32000,
          message: 'Model routing unavailable or task exceeds policy limits; turn was not started. Check the local model catalog and thread state.' } });
        else close();
      }
    };
    if (message.method === 'turn/start') {
      if (queued >= 8) { sendClient({ id: message.id, error: { code: -32001, message: 'Router overloaded' } }); return; }
      queued++;
      turns = turns.then(forward).finally(() => queued--);
    } else void forward(); // Steering, interrupts and approval responses must not wait behind model discovery.
  });
  return { close, child };
}

/** Private Unix socket keeps the native TUI local without an exposed TCP service. */
export async function startModelProxy({ cwd, knowledge, codexBin = 'codex', env = process.env,
  serverArgs = [], model = null, effort = null, onDecision = () => {}, spawnImpl = spawn } = {}) {
  if (process.platform === 'win32') throw new Error('Native auto routing currently requires Unix sockets (Linux/macOS)');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-codex-auto-'));
  fs.chmodSync(directory, 0o700);
  const socketPath = path.join(directory, 'router.sock');
  const server = http.createServer((_request, response) => { response.writeHead(403); response.end(); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES, perMessageDeflate: false });
  let backend = null, accepted = false;
  server.on('upgrade', (request, socket, head) => {
    // Native Unix-socket clients upgrade /rpc; generic ws+unix clients default to /.
    if (request.headers.origin !== undefined || !['/', '/rpc'].includes(request.url) || accepted) { socket.destroy(); return; }
    accepted = true;
    sockets.handleUpgrade(request, socket, head, client => {
      backend = attachBackend(client, { cwd, knowledge, codexBin, env, serverArgs, model, effort, onDecision, spawnImpl });
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    fs.chmodSync(socketPath, 0o600);
  } catch (error) { server.close(); fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  let stopping = null;
  return { endpoint: `unix://${socketPath}`, socketPath,
    close() {
      if (!stopping) stopping = (async () => {
        backend?.close();
        for (const client of sockets.clients) client.terminate();
        await new Promise(resolve => server.close(resolve));
        sockets.close();
        fs.rmSync(directory, { recursive: true, force: true });
      })();
      return stopping;
    }
  };
}
