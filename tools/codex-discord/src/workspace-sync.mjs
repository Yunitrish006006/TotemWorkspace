import { CONVERSATION_MIRROR_EVENTS } from '../../../intelligence/conversation-sync.mjs';
/** Display-only projection. Codex execution, approvals and sessions stay in the local runtime. */
export function isWorkspaceSyncEnabled(config, workspaceName) {
  return Boolean(config.workspaceSync && config.workspaceSync.workspaceName === workspaceName);
}


export function createWorkspaceSync({ config, fetchImpl = globalThis.fetch, log = console.warn } = {}) {
  const settings = config?.workspaceSync;
  const runs = new Map();
  const finished = new Set();
  let stopped = false;
  async function pump(runId, state) {
    while (!stopped && state.pending.length) {
      const entry = state.pending.shift();
      try {
        const response = await fetchImpl(new URL('/api/conversation/mirror', settings.url), {
          method: 'POST', signal: AbortSignal.timeout(5000),
          headers: { authorization: `Bearer ${settings.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(entry)
        });
        if (!response.ok) throw new Error('Mirror unavailable');
        await response.body?.cancel();
      } catch { log('Viewer display sync unavailable; Codex execution continues locally.'); }
    }
    runs.delete(runId);
  }
  function record(workspace, entry) {
    if (stopped || !isWorkspaceSyncEnabled(config, workspace) || finished.has(entry.runId)) return;
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(entry.runId) || !Object.hasOwn(CONVERSATION_MIRROR_EVENTS, entry.event)) return;
    const value = { runId: entry.runId, event: entry.event };
    let state = runs.get(entry.runId);
    if (!state) {
      if (runs.size >= 64) return;
      state = { pending: [], promise: null };
      runs.set(entry.runId, state);
    }
    if (CONVERSATION_MIRROR_EVENTS[value.event][0] === 'progress')
      state.pending = state.pending.filter(item => CONVERSATION_MIRROR_EVENTS[item.event][0] !== 'progress');
    if (state.pending.length >= 3) return;
    state.pending.push(value);
    if (value.event === 'completed' || value.event === 'failed') {
      finished.add(entry.runId);
      if (finished.size > 128) finished.delete(finished.values().next().value);
    }
    if (!state.promise) state.promise = pump(entry.runId, state);
  }
  return Object.freeze({
    enabled: Boolean(settings), record,
    progress(workspace, runId, event) {
      const type = event.params?.item?.type;
      const code = event.method === 'bridge/modelPolicy' ? 'preparing'
        : event.method === 'item/started' ? ({ commandExecution: 'command', fileChange: 'files',
          mcpToolCall: 'tool', collabAgentToolCall: 'collaboration' }[type]) : null;
      if (code) record(workspace, { runId, event: code });
    },
    drain: () => Promise.all([...runs.values()].map(state => state.promise)),
    stop() { stopped = true; for (const state of runs.values()) state.pending.length = 0; }
  });
}
