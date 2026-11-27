import path from "node:path";
import { lstatSync, readdirSync } from "node:fs";
import { validateUsageGuardMode } from '../../../intelligence/agent-runtime/usage-guard.mjs';
import { validateWorkloadScopeMode } from '../../../intelligence/agent-runtime/process-scope.mjs';

const DISCORD_ID = /^\d{17,20}$/;
const WORKSPACE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const THREAD_ID = /^[a-zA-Z0-9_.:/-]{1,200}$/;

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function idSet(env, name) {
  const values = required(env, name).split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.some((value) => !DISCORD_ID.test(value))) {
    throw new Error(`${name} must contain one or more Discord snowflake IDs`);
  }
  return new Set(values);
}

function featureFlag(env, name) {
  const value = env[name]?.trim().toLowerCase();
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function parseHistoryThreadGrants(env, allowedUserIds) {
  const raw = env.CODEX_HISTORY_THREAD_GRANTS_JSON?.trim();
  if (!raw) return Object.freeze([]);
  let grants;
  try { grants = JSON.parse(raw); }
  catch { throw new Error('CODEX_HISTORY_THREAD_GRANTS_JSON must be a JSON array'); }
  if (!Array.isArray(grants) || grants.length > 500) {
    throw new Error('CODEX_HISTORY_THREAD_GRANTS_JSON must be an array of at most 500 grants');
  }
  const seen = new Set();
  return Object.freeze(grants.map(grant => {
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)
      || Object.keys(grant).some(key => !['threadId', 'userId'].includes(key))
      || typeof grant.threadId !== 'string' || !THREAD_ID.test(grant.threadId)
      || typeof grant.userId !== 'string' || !DISCORD_ID.test(grant.userId)
      || !allowedUserIds.has(grant.userId) || seen.has(grant.threadId)) {
      throw new Error('CODEX_HISTORY_THREAD_GRANTS_JSON contains an invalid or duplicate grant');
    }
    seen.add(grant.threadId);
    return Object.freeze({ threadId: grant.threadId, userId: grant.userId });
  }));
}

function discoveredWorkspaceName(directoryName) {
  const name = directoryName.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return WORKSPACE_NAME.test(name) ? name : null;
}

function addRepositoryWorkspaces(workspaces, rootWorkspace) {
  if (!rootWorkspace) return;
  let entries;
  try {
    entries = readdirSync(rootWorkspace, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
    throw new Error(`CODEX_WORKSPACE_ROOT could not be scanned: ${error.message}`);
  }
  const paths = new Set([...workspaces.values()].map(({ path: workspacePath }) => path.resolve(workspacePath)));
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const repositoryPath = path.join(rootWorkspace, entry.name);
    let gitEntry;
    try { gitEntry = lstatSync(path.join(repositoryPath, ".git")); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`Could not inspect repository metadata for ${entry.name}: ${error.message}`);
    }
    if (!gitEntry.isDirectory() && !gitEntry.isFile()) continue;
    const resolvedPath = path.resolve(repositoryPath);
    if (paths.has(resolvedPath)) continue;
    const name = discoveredWorkspaceName(entry.name);
    if (!name) continue;
    if (workspaces.has(name)) {
      throw new Error(`Discovered repository ${entry.name} conflicts with configured workspace ${name}`);
    }
    workspaces.set(name, Object.freeze({ path: resolvedPath, allowNonGit: false }));
    paths.add(resolvedPath);
  }
}

function workspaceMap(env) {
  let parsed;
  try {
    parsed = JSON.parse(required(env, "CODEX_WORKSPACES_JSON"));
  } catch (error) {
    throw new Error(`CODEX_WORKSPACES_JSON must be a JSON object: ${error.message}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("CODEX_WORKSPACES_JSON must be a non-empty object");
  }
  const rootWorkspace = env.CODEX_WORKSPACE_ROOT?.trim();
  if (rootWorkspace && !Object.hasOwn(parsed, "workspace")) {
    parsed.workspace = { path: rootWorkspace, allowNonGit: true };
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) throw new Error("CODEX_WORKSPACES_JSON must not be empty");

  const workspaces = new Map();
  for (const [name, configured] of entries) {
    if (!WORKSPACE_NAME.test(name)) throw new Error(`Invalid workspace name: ${name}`);
    const candidate = typeof configured === "string" ? { path: configured, allowNonGit: false } : configured;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Workspace ${name} must be a path string or configuration object`);
    }
    if (candidate.allowNonGit !== undefined && typeof candidate.allowNonGit !== "boolean") {
      throw new Error(`Workspace ${name} allowNonGit must be a boolean`);
    }
    if (typeof candidate.path !== "string" || !path.isAbsolute(candidate.path)) {
      throw new Error(`Workspace ${name} must use an absolute path`);
    }
    workspaces.set(name, Object.freeze({
      path: path.resolve(candidate.path),
      allowNonGit: candidate.allowNonGit === true
    }));
  }
  addRepositoryWorkspaces(workspaces, rootWorkspace ? path.resolve(rootWorkspace) : null);
  return workspaces;
}

function runtimeSeconds(env) {
  const raw = env.CODEX_MAX_RUNTIME_SECONDS?.trim() || "0";
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(seconds) || (seconds !== 0 && (seconds < 30 || seconds > 7200))) {
    throw new Error("CODEX_MAX_RUNTIME_SECONDS must be 0 (unlimited) or an integer from 30 to 7200");
  }
  return seconds;
}

function workspaceSync(env, allowedChannelIds) {
  const urlValue = env.TOTEM_WORKSPACE_SYNC_URL?.trim();
  const token = env.TOTEM_WORKSPACE_SYNC_TOKEN?.trim();
  const channelId = env.TOTEM_WORKSPACE_SYNC_CHANNEL_ID?.trim();
  const workspaceName = env.TOTEM_WORKSPACE_SYNC_WORKSPACE?.trim() || "workspace";
  if (!urlValue && !token && !channelId && !env.TOTEM_WORKSPACE_SYNC_WORKSPACE?.trim()) return null;
  if (!urlValue || !token || !channelId) {
    throw new Error("TOTEM_WORKSPACE_SYNC_URL, TOTEM_WORKSPACE_SYNC_TOKEN, and TOTEM_WORKSPACE_SYNC_CHANNEL_ID must be configured together");
  }
  if (!DISCORD_ID.test(channelId) || !allowedChannelIds.has(channelId)) {
    throw new Error("TOTEM_WORKSPACE_SYNC_CHANNEL_ID must be an allowed Discord channel ID");
  }
  if (!WORKSPACE_NAME.test(workspaceName)) throw new Error("TOTEM_WORKSPACE_SYNC_WORKSPACE must be a configured workspace name");
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("TOTEM_WORKSPACE_SYNC_URL must be a valid URL");
  }
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
  if (!loopback) throw new Error("TOTEM_WORKSPACE_SYNC_URL must use an http loopback host");
  if (token.length < 16) throw new Error("TOTEM_WORKSPACE_SYNC_TOKEN must contain at least 16 characters");
  return Object.freeze({
    url: url.toString(),
    token,
    channelId,
    workspaceName
  });
}

export function loadConfig(env = process.env) {
  const applicationId = required(env, "DISCORD_APPLICATION_ID");
  const bridgeApplicationId = required(env, "DISCORD_BRIDGE_APPLICATION_ID");
  const guildId = required(env, "DISCORD_GUILD_ID");
  if (!DISCORD_ID.test(applicationId) || !DISCORD_ID.test(bridgeApplicationId) || !DISCORD_ID.test(guildId)) {
    throw new Error("Discord application and guild IDs must be Discord snowflake IDs");
  }
  if (applicationId === bridgeApplicationId) {
    throw new Error("Discord Codex must use a different Application than the Minecraft Discord Bridge");
  }
  const allowedUserIds = idSet(env, "DISCORD_ALLOWED_USER_IDS");
  const allowedChannelIds = idSet(env, "DISCORD_ALLOWED_CHANNEL_IDS");
  const historyOwnerUserId = env.CODEX_HISTORY_OWNER_USER_ID?.trim() || null;
  if (historyOwnerUserId && (!DISCORD_ID.test(historyOwnerUserId) || !allowedUserIds.has(historyOwnerUserId))) {
    throw new Error('CODEX_HISTORY_OWNER_USER_ID must be a Discord ID in DISCORD_ALLOWED_USER_IDS');
  }
  const historyThreadGrants = parseHistoryThreadGrants(env, allowedUserIds);
  const workspaces = workspaceMap(env);
  const sync = workspaceSync(env, allowedChannelIds);
  if (sync && !workspaces.has(sync.workspaceName)) {
    throw new Error("TOTEM_WORKSPACE_SYNC_WORKSPACE must name a configured workspace");
  }
  return Object.freeze({
    botToken: required(env, "DISCORD_BOT_TOKEN"),
    applicationId,
    bridgeApplicationId,
    guildId,
    allowedUserIds,
    allowedChannelIds,
    historyEnabled: featureFlag(env, 'CODEX_DISCORD_HISTORY_ENABLED'),
    goalsEnabled: featureFlag(env, 'CODEX_DISCORD_GOALS_ENABLED'),
    historyOwnerUserId,
    historyThreadGrants,
    workspaces,
    maxRuntimeMs: runtimeSeconds(env) * 1000,
    usageGuardMode: validateUsageGuardMode(env.CODEX_USAGE_GUARD_MODE?.trim() || 'enforce'),
    workloadScopeMode: validateWorkloadScopeMode(env.CODEX_WORKLOAD_SCOPE_MODE?.trim() || 'auto'),
    stateDir: path.resolve(env.CODEX_STATE_DIR || "data"),
    workspaceSync: sync
  });
}

function isAllowed({ userId, channelId, parentId }, config) {
  if (!config.allowedUserIds.has(userId)) return false;
  return config.allowedChannelIds.has(channelId)
    || (parentId !== null && parentId !== undefined && config.allowedChannelIds.has(parentId));
}

export function isAllowedInteraction(interaction, config) {
  return isAllowed({
    userId: interaction.user.id,
    channelId: interaction.channelId,
    parentId: interaction.channel?.parentId
  }, config);
}

export function isAllowedMessage(message, config) {
  return isAllowed({
    userId: message.author.id,
    channelId: message.channelId,
    parentId: message.channel?.parentId
  }, config);
}
