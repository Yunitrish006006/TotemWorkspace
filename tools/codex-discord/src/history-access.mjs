import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

const DISCORD_ID = /^\d{17,20}$/;
const THREAD_ID = /^[a-zA-Z0-9_.:/-]{1,200}$/;
const SOURCE_KINDS = new Set(['cli', 'vscode', 'appServer', 'unknown']);
const NATIVE_OWNER_SOURCES = new Set(['cli', 'vscode']);
const GRANT_SOURCES = new Set(['appServer', 'unknown']);
const CURSOR_TTL_MS = 5 * 60_000;
const MAX_CURSORS_PER_USER = 2;
const MAX_CANDIDATES_PER_USER = 20;
const SOURCE_KEY = /^[a-zA-Z0-9_.:-]{1,80}$/;

function unavailable() {
  return Object.assign(new Error('History is unavailable'), { code: 'HISTORY_UNAVAILABLE' });
}

function sameContext(expected, actual) {
  return expected.userId === actual.userId && expected.guildId === actual.guildId
    && expected.channelId === actual.channelId && expected.workspaceName === actual.workspaceName
    && expected.canonicalWorkspacePath === actual.canonicalWorkspacePath;
}

function cleanQuery(query) {
  if (query === undefined || query === null) return '';
  if (typeof query !== 'string' || query.length > 256) throw new TypeError('query must be at most 256 characters');
  return query;
}

function cleanSource(source) {
  if (typeof source !== 'string' || (source !== 'all' && !SOURCE_KINDS.has(source))) throw new TypeError('source is unsupported');
  return source;
}

function cleanCursors(cursors, configuredPath) {
  if (!Array.isArray(cursors) || cursors.length > 20) throw new TypeError('cursor state is invalid');
  const seen = new Set();
  return cursors.map(entry => {
    if (!entry || entry.cwd !== configuredPath || typeof entry.cursor !== 'string'
      || entry.cursor.length < 1 || entry.cursor.length > 512 || seen.has(entry.cwd)) {
      throw new TypeError('cursor state is invalid');
    }
    seen.add(entry.cwd);
    return Object.freeze({ cwd: entry.cwd, cursor: entry.cursor });
  });
}

/** Central fail-closed user/channel/workspace and thread ownership policy. */
export function createHistoryAccess({ config, ownership, sourceKey = 'codex-local', now = Date.now,
  realpathImpl = realpath, randomBytesImpl = randomBytes } = {}) {
  if (!config || !ownership || typeof ownership.get !== 'function' || typeof ownership.claim !== 'function') {
    throw new TypeError('config and a thread ownership store are required');
  }
  if (typeof sourceKey !== 'string' || !SOURCE_KEY.test(sourceKey)) throw new TypeError('sourceKey is invalid');
  const cursors = new Map();
  const candidates = new Map();

  function revokeUserTokens(userId) {
    for (const [token, value] of cursors) if (value.userId === userId) cursors.delete(token);
    for (const [token, value] of candidates) if (value.userId === userId) candidates.delete(token);
  }

  function pruneExpired() {
    const timestamp = now();
    for (const [token, value] of cursors) if (value.expiresAt <= timestamp) cursors.delete(token);
    for (const [token, value] of candidates) if (value.expiresAt <= timestamp) candidates.delete(token);
  }

  async function authorizeContext(context = {}) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) throw unavailable();
    const { userId, guildId, channelId, parentId = null, workspaceName } = context;
    if (!config.historyEnabled || typeof userId !== 'string' || !DISCORD_ID.test(userId)
      || !config.allowedUserIds?.has(userId) || guildId !== config.guildId
      || typeof channelId !== 'string' || !DISCORD_ID.test(channelId)
      || !(config.allowedChannelIds?.has(channelId) || (typeof parentId === 'string' && config.allowedChannelIds?.has(parentId)))) {
      throw unavailable();
    }
    const workspace = config.workspaces?.get(workspaceName);
    if (!workspace || typeof workspace.path !== 'string' || !path.isAbsolute(workspace.path)) throw unavailable();
    let canonicalWorkspacePath;
    try { canonicalWorkspacePath = await realpathImpl(workspace.path); }
    catch { throw unavailable(); }
    return Object.freeze({ userId, guildId, channelId, workspaceName,
      workspacePath: path.resolve(workspace.path), canonicalWorkspacePath });
  }

  async function assertThreadReadable(context, metadata) {
    let scope;
    try { scope = await authorizeContext(context); }
    catch (error) { revokeUserTokens(context?.userId); throw error; }
    if (!metadata || typeof metadata.id !== 'string' || !THREAD_ID.test(metadata.id)
      || typeof metadata.cwd !== 'string' || !path.isAbsolute(metadata.cwd)
      || typeof metadata.source !== 'string' || !SOURCE_KINDS.has(metadata.source)) throw unavailable();
    let actualWorkspacePath;
    try { actualWorkspacePath = await realpathImpl(metadata.cwd); }
    catch { throw unavailable(); }
    if (actualWorkspacePath !== scope.canonicalWorkspacePath) throw unavailable();

    let existing;
    try { existing = ownership.get({ sourceKey, threadId: metadata.id }); }
    catch { throw unavailable(); }
    if (existing) {
      if (existing.ownerUserId !== scope.userId) throw unavailable();
      return Object.freeze({ ...scope, threadId: metadata.id, source: metadata.source, provenance: existing.provenance });
    }

    const ownerUserId = config.historyOwnerUserId;
    if (ownerUserId && ownerUserId === scope.userId && NATIVE_OWNER_SOURCES.has(metadata.source)) {
      try { await ownership.claim({ sourceKey, threadId: metadata.id, ownerUserId, provenance: 'native-source-owner' }); }
      catch { throw unavailable(); }
      return Object.freeze({ ...scope, threadId: metadata.id, source: metadata.source, provenance: 'native-source-owner' });
    }

    const grant = config.historyThreadGrants?.find?.(entry => entry.threadId === metadata.id && entry.userId === scope.userId);
    if (grant && GRANT_SOURCES.has(metadata.source)) {
      try { await ownership.claim({ sourceKey, threadId: metadata.id, ownerUserId: scope.userId, provenance: 'host-grant' }); }
      catch { throw unavailable(); }
      return Object.freeze({ ...scope, threadId: metadata.id, source: metadata.source, provenance: 'host-grant' });
    }
    throw unavailable();
  }

  async function filterThreads(context, threads) {
    try { await authorizeContext(context); }
    catch (error) { revokeUserTokens(context?.userId); throw error; }
    if (!Array.isArray(threads)) throw new TypeError('threads must be an array');
    const visible = [];
    for (const thread of threads) {
      try { await assertThreadReadable(context, thread); visible.push(thread); }
      catch { /* Denied candidates are indistinguishable from absent threads. */ }
    }
    return visible;
  }

  async function issueCursor(context, { query = '', source, cursors: pageCursors } = {}) {
    pruneExpired();
    let scope;
    try { scope = await authorizeContext(context); }
    catch (error) { revokeUserTokens(context?.userId); throw error; }
    const normalizedQuery = cleanQuery(query);
    const normalizedSource = cleanSource(source);
    const normalizedCursors = cleanCursors(pageCursors, scope.workspacePath);
    const pending = [...cursors.values()].filter(value => value.userId === scope.userId).length;
    if (pending >= MAX_CURSORS_PER_USER) throw Object.assign(new Error('History request capacity reached'), { code: 'HISTORY_CAPACITY' });
    const token = randomBytesImpl(24).toString('base64url');
    if (!/^[A-Za-z0-9_-]{32}$/.test(token) || cursors.has(token)) throw new Error('History cursor token generation failed');
    const expiresAt = now() + CURSOR_TTL_MS;
    cursors.set(token, Object.freeze({ ...scope, userId: scope.userId, query: normalizedQuery,
      source: normalizedSource, cursors: normalizedCursors, expiresAt }));
    return Object.freeze({ token, expiresAt });
  }

  async function issueCandidate(context, metadata, { query = '' } = {}) {
    pruneExpired();
    let authorized;
    try { authorized = await assertThreadReadable(context, metadata); }
    catch (error) { revokeUserTokens(context?.userId); throw error; }
    const normalizedQuery = cleanQuery(query);
    const pending = [...candidates.values()].filter(value => value.userId === authorized.userId).length;
    if (pending >= MAX_CANDIDATES_PER_USER) throw Object.assign(new Error('History candidate capacity reached'), { code: 'HISTORY_CAPACITY' });
    const token = randomBytesImpl(24).toString('base64url');
    if (!/^[A-Za-z0-9_-]{32}$/.test(token) || candidates.has(token) || cursors.has(token)) {
      throw new Error('History candidate token generation failed');
    }
    const expiresAt = now() + CURSOR_TTL_MS;
    candidates.set(token, Object.freeze({ ...authorized, query: normalizedQuery,
      updatedAt: Number.isFinite(metadata.updatedAt) ? metadata.updatedAt : null, expiresAt }));
    return Object.freeze({ token, expiresAt });
  }

  async function resolveCandidate(context, { token, query = '', readMetadata } = {}) {
    pruneExpired();
    let scope;
    try { scope = await authorizeContext(context); }
    catch (error) { revokeUserTokens(context?.userId); throw error; }
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token) || typeof readMetadata !== 'function') throw unavailable();
    const value = candidates.get(token);
    if (!value) throw Object.assign(new Error('History candidate expired or unavailable'), { code: 'HISTORY_CANDIDATE_EXPIRED' });
    let queryMatches = false;
    try { queryMatches = value.query === cleanQuery(query); } catch { /* Consume invalid candidate input. */ }
    if (!sameContext(value, scope) || !queryMatches) {
      candidates.delete(token);
      throw Object.assign(new Error('History candidate expired or unavailable'), { code: 'HISTORY_CANDIDATE_EXPIRED' });
    }
    let metadata;
    try {
      metadata = await readMetadata({ threadId: value.threadId, cwd: value.workspacePath, sourceKinds: [value.source] });
      if (metadata?.id !== value.threadId || metadata?.source !== value.source
        || (value.updatedAt !== null && metadata.updatedAt !== value.updatedAt)) throw unavailable();
      await assertThreadReadable(context, metadata);
    } catch {
      candidates.delete(token);
      throw unavailable();
    }
    return Object.freeze({ threadId: value.threadId, source: value.source,
      updatedAt: value.updatedAt, expiresAt: value.expiresAt });
  }

  async function resolveCursor(context, { token, query = '', source } = {}) {
    pruneExpired();
    let scope;
    try { scope = await authorizeContext(context); }
    catch (error) { revokeUserTokens(context?.userId); throw error; }
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) throw unavailable();
    const value = cursors.get(token);
    if (!value) throw Object.assign(new Error('History cursor expired or unavailable'), { code: 'HISTORY_CURSOR_EXPIRED' });
    let match = false;
    try { match = sameContext(value, scope) && value.query === cleanQuery(query) && value.source === cleanSource(source); }
    catch { /* A changed filter is a consumed, invalid cursor. */ }
    cursors.delete(token);
    if (!match) throw Object.assign(new Error('History cursor expired or unavailable'), { code: 'HISTORY_CURSOR_EXPIRED' });
    return Object.freeze({ cursors: value.cursors.map(entry => ({ ...entry })), expiresAt: value.expiresAt,
      workspaceName: value.workspaceName, source: value.source });
  }

  return Object.freeze({ authorizeContext, assertThreadReadable, filterThreads, issueCursor, resolveCursor,
    issueCandidate, resolveCandidate });
}
