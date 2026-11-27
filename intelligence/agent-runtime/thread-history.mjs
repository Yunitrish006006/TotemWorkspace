const MAX_PAGE_SIZE = 20;
const MAX_TURN_PAGE_SIZE = 5;
const MAX_THREAD_PAGE_SIZE = 10;
const LIST_SOURCE_KINDS = ['cli', 'vscode', 'appServer'];
const METADATA_SOURCE_KINDS = [...LIST_SOURCE_KINDS, 'unknown'];
const SAFE_ID = /^[a-zA-Z0-9_.:/-]{1,200}$/;

function validId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function validateSources(sourceKinds, allowed = LIST_SOURCE_KINDS) {
  if (!Array.isArray(sourceKinds) || sourceKinds.length === 0
    || sourceKinds.some(kind => !allowed.includes(kind))) throw new TypeError('sourceKinds contains an unsupported source');
  return [...new Set(sourceKinds)];
}

function nextCursor(result, seen) {
  const cursor = result?.nextCursor ?? null;
  if (cursor === null || cursor === '') return null;
  if (typeof cursor !== 'string' || cursor.length > 512 || seen.has(cursor)) {
    throw Object.assign(new Error('Thread history pagination unavailable'), { code: 'THREAD_PAGINATION_INVALID' });
  }
  seen.add(cursor);
  return cursor;
}

function validateCursor(cursor) {
  if (cursor !== null && cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 512)) {
    throw new TypeError('cursor must be null or a string no longer than 512 characters');
  }
  return cursor ?? null;
}

function cleanThread(thread) {
  if (!thread || typeof thread.id !== 'string' || !SAFE_ID.test(thread.id)) return null;
  return {
    id: thread.id,
    title: typeof thread.title === 'string' ? thread.title.slice(0, 240) : '',
    cwd: typeof thread.cwd === 'string' ? thread.cwd.slice(0, 1024) : null,
    source: typeof thread.source === 'string' ? thread.source.slice(0, 40) : null,
    updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt : null,
    createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt : null,
    archived: thread.archived === true,
    canAcceptDirectInput: typeof thread.canAcceptDirectInput === 'boolean' ? thread.canAcceptDirectInput : null,
    runtimeStatus: ['active', 'idle', 'notLoaded'].includes(thread.status) ? thread.status : null
  };
}

/** List only the configured exact workspace roots; do not authorize by path prefix. */
export async function listThreads(client, { workspaces, sourceKinds = LIST_SOURCE_KINDS,
  cursors = [], limit = MAX_THREAD_PAGE_SIZE } = {}) {
  if (!Array.isArray(workspaces) || workspaces.length === 0 || workspaces.length > 20
    || workspaces.some(root => typeof root !== 'string' || !root.startsWith('/'))) {
    throw new TypeError('workspaces must contain 1 to 20 absolute paths');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_THREAD_PAGE_SIZE) throw new RangeError('limit must be between 1 and 10');
  const kinds = validateSources(sourceKinds);
  const roots = [...new Set(workspaces)];
  if (!Array.isArray(cursors) || cursors.some(entry => !entry || !roots.includes(entry.cwd)
    || typeof entry.cursor !== 'string' || entry.cursor.length > 512)
    || new Set(cursors.map(entry => entry.cwd)).size !== cursors.length) {
    throw new TypeError('cursors must contain unique configured cwd/cursor pairs');
  }
  const collected = [];
  const nextCursors = [];
  for (const cwd of roots) {
    const currentCursor = validateCursor(cursors.find(entry => entry.cwd === cwd)?.cursor);
    const result = await client.listThreads({ cwd, sourceKinds: kinds, limit, cursor: currentCursor,
      sortKey: 'updated_at', sortDirection: 'desc', archived: false, useStateDbOnly: true });
    if (!Array.isArray(result?.data)) throw Object.assign(new Error('Thread list unavailable'), { code: 'THREAD_CAPABILITY_UNAVAILABLE' });
    for (const value of result.data) {
      const thread = cleanThread(value);
      if (thread && thread.cwd === cwd && !thread.archived && kinds.includes(thread.source)) collected.push(thread);
    }
    const cursor = nextCursor(result, new Set(currentCursor ? [currentCursor] : []));
    if (cursor) nextCursors.push({ cwd, cursor });
  }
  const unique = [...new Map(collected.map(thread => [thread.id, thread])).values()];
  return { threads: unique.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, limit), nextCursors };
}

export async function readThreadMetadata(client, { threadId, cwd, sourceKinds = LIST_SOURCE_KINDS } = {}) {
  validId(threadId, 'threadId');
  const kinds = validateSources(sourceKinds, METADATA_SOURCE_KINDS);
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) throw new TypeError('cwd must be an absolute path');
  const result = await client.readThread({ threadId, includeTurns: false });
  const thread = cleanThread(result?.thread);
  if (!thread || thread.id !== threadId || thread.cwd !== cwd || !kinds.includes(thread.source)) {
    throw Object.assign(new Error('Thread is outside the requested history scope'), { code: 'THREAD_SCOPE_MISMATCH' });
  }
  return thread;
}

export async function listTurns(client, { threadId, cursor = null, limit = MAX_TURN_PAGE_SIZE } = {}) {
  validId(threadId, 'threadId');
  cursor = validateCursor(cursor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TURN_PAGE_SIZE) throw new RangeError('turn limit must be between 1 and 5');
  const result = await client.listTurns({ threadId, cursor, limit, itemsView: 'summary' });
  if (!Array.isArray(result?.data)) throw Object.assign(new Error('Turn list unavailable'), { code: 'THREAD_CAPABILITY_UNAVAILABLE' });
  const turns = result.data.map(turn => ({
    id: typeof turn.id === 'string' && SAFE_ID.test(turn.id) ? turn.id : null,
    status: typeof turn.status === 'string' ? turn.status.slice(0, 32) : null,
    startedAt: Number.isFinite(turn.startedAt) ? turn.startedAt : null,
    completedAt: Number.isFinite(turn.completedAt) ? turn.completedAt : null
  })).filter(turn => turn.id);
  return { turns, nextCursor: nextCursor(result, new Set(cursor ? [cursor] : [])) };
}

function cleanMessage(item) {
  const type = item?.type;
  if (type !== 'userMessage' && type !== 'agentMessage') return null;
  const text = type === 'agentMessage'
    ? (typeof item.text === 'string' ? item.text : '')
    : (Array.isArray(item.content) ? item.content : [])
      .filter(part => part?.type === 'text')
      .map(part => typeof part.text === 'string' ? part.text : '').join('');
  return text ? { role: type === 'userMessage' ? 'user' : 'assistant', text: text.slice(0, 20_000) } : null;
}

export async function listItems(client, { threadId, turnId, cursor = null, limit = MAX_PAGE_SIZE } = {}) {
  validId(threadId, 'threadId'); validId(turnId, 'turnId');
  cursor = validateCursor(cursor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new RangeError('item limit must be between 1 and 20');
  const result = await client.listItems({ threadId, turnId, cursor, limit });
  if (!Array.isArray(result?.data)) throw Object.assign(new Error('Thread item list unavailable'), { code: 'THREAD_CAPABILITY_UNAVAILABLE' });
  const messages = result.data.filter(entry => entry.turnId === turnId)
    .map(entry => cleanMessage(entry.item)).filter(Boolean);
  return { messages, nextCursor: nextCursor(result, new Set(cursor ? [cursor] : [])) };
}
