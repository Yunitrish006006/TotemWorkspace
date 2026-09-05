#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildGraphViewModel } from "../intelligence/code-graph.mjs";
import { loadCodeIndex, refreshCodeIndex } from "../intelligence/code-index.mjs";
import {
  buildChangeIntelligence,
  collectGitChanges,
  loadChangeIntelligence,
  mapGitChangesToSemantic,
  saveChangeIntelligence
} from "../intelligence/change-intelligence.mjs";
import { defaultReposRoot, loadKnowledge, workspaceStatus } from "../intelligence/workspace-knowledge.mjs";
import {
  recordVerificationEvent,
  verificationStatePayload,
  verificationStatePayloadFromState
} from "../intelligence/verification-state.mjs";
import {
  appendReplayEvent,
  loadDevelopmentReplay,
  recordReplayCheckpoint,
  replayActivityTail,
  replayFramePayload,
  replayTimelinePayload,
  replayVerificationStateAt
} from "../intelligence/development-replay.mjs";
import { createAgentAdapter } from "../intelligence/agent-adapter.mjs";
import { createConversationSync } from "../intelligence/conversation-sync.mjs";
import {
  buildOrchestrationPlan,
  orchestrationPlanSummary
} from "../intelligence/orchestration-plan.mjs";
import { renderGraphV2 } from "./render-graph-v2.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 18765;
const FLUTTER_WEB_ROOT = path.join(ROOT, "viewer_flutter", "build", "web");
const BODY_LIMIT = 64 * 1024;
const PROMPT_LIMIT = 8 * 1024;
const ACTIVITY_LIMIT = 500;
const APPROVED_BROWSER_ORIGINS = new Set([
  "https://yunitrish006006.github.io"
]);

const DEFAULT_VIEWER_SETTINGS = Object.freeze({
  schemaVersion: 1,
  promptEnabled: false,
  agentActivityEnabled: true,
  changeAnimationsEnabled: true,
  autoExpandAgentFocus: true,
  replayEnabled: true
});

const ACTIVITY_TYPES = new Set([
  "task_started",
  "task_completed",
  "task_failed",
  "thread_started",
  "turn_started",
  "command_started",
  "command_completed",
  "tool_started",
  "tool_completed",
  "web_search_started",
  "web_search_completed",
  "todo_updated",
  "agent_message",
  "usage_updated",
  "prompt_submitted",
  "orchestration_planned",
  "feature_selected",
  "file_read",
  "file_edit",
  "symbol_read",
  "symbol_edit",
  "dependency_followed",
  "test_started",
  "test_passed",
  "test_failed",
  "relation_added",
  "relation_removed",
  "git_diff_updated",
  "commit_created",
  "pr_created",
  "pr_merged",
  "deployment_started",
  "deployment_completed",
  "deployment_failed"
]);

const replayBootstrap = replayActivityTail(ROOT, { limit: ACTIVITY_LIMIT });
let activitySequence = replayBootstrap.latestSequence;
const activityEvents = [...replayBootstrap.events];

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
});

function json(res, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function isLoopbackOrigin(origin) {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(String(origin ?? ""));
}

function isApprovedBrowserOrigin(origin) {
  const value = String(origin ?? "");
  return isLoopbackOrigin(value) || APPROVED_BROWSER_ORIGINS.has(value);
}

function prepareApiCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!isApprovedBrowserOrigin(origin)) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (String(req.headers["access-control-request-private-network"] ?? "").toLowerCase() === "true") {
    res.setHeader("access-control-allow-private-network", "true");
  }
  res.setHeader("vary", "Origin");
  return true;
}

function bearerToken(req) {
  const value = String(req.headers.authorization ?? "");
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : null;
}

function sameSecret(expected, received) {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasLoopbackConversationAccess(req) {
  const origin = req.headers.origin;
  return !origin || isLoopbackOrigin(origin);
}

function safeConversationProgress(event) {
  const taskId = boundedText(event?.taskId, 160);
  if (!taskId) return null;
  const type = boundedText(event?.type, 64);
  const status = boundedText(event?.status, 80);
  const summaries = {
    task_started: "Codex task started",
    thread_started: "Codex session started",
    turn_started: "Codex is processing the request",
    command_started: "Codex is running a local command",
    command_completed: status === "failed" ? "A local command failed" : "A local command completed",
    tool_started: "Codex is using an integration tool",
    tool_completed: status === "failed" ? "An integration tool failed" : "An integration tool completed",
    file_edit: "Codex changed a workspace file",
    todo_updated: "Codex updated its plan",
    web_search_started: "Codex started a web search",
    web_search_completed: "Codex completed a web search",
    usage_updated: "Codex updated task usage",
    task_completed: "Codex task completed",
    task_failed: "Codex task failed"
  };
  const text = summaries[type];
  return text ? { text, taskId, status } : null;
}

function publicStatus(entry) {
  return Object.freeze({
    id: entry.id,
    repoName: entry.repoName,
    present: entry.present,
    head: entry.head ?? null,
    branch: entry.branch ?? null,
    dirty: entry.dirty ?? false,
    snapshotMatch: entry.snapshotMatch ?? false,
    expectedCommit: entry.expectedCommit ?? null,
    expectedBranch: entry.expectedBranch ?? null
  });
}

function viewerSettingsPath() {
  return path.join(ROOT, ".totem-index", "viewer-settings.json");
}

function normalizeViewerSettings(value = {}) {
  const next = { ...DEFAULT_VIEWER_SETTINGS };
  for (const key of Object.keys(DEFAULT_VIEWER_SETTINGS)) {
    if (key === "schemaVersion") continue;
    if (typeof value[key] === "boolean") next[key] = value[key];
  }
  return Object.freeze(next);
}

function loadViewerSettings() {
  try {
    return normalizeViewerSettings(JSON.parse(fs.readFileSync(viewerSettingsPath(), "utf8")));
  } catch {
    return DEFAULT_VIEWER_SETTINGS;
  }
}

function saveViewerSettings(value) {
  const next = normalizeViewerSettings(value);
  const filePath = viewerSettingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
  return next;
}

function boundedText(value, maxLength) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function relativeCodePath(value) {
  const text = boundedText(value, 512);
  if (!text) return null;
  if (path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text)) {
    throw new Error("activity file paths must be repository-relative");
  }
  return text.replaceAll("\\", "/");
}

function normalizeActivityEvent(value = {}, { source = "bridge" } = {}) {
  const type = boundedText(value.type, 64);
  if (!type || !ACTIVITY_TYPES.has(type)) throw new Error(`unsupported activity type: ${type ?? "missing"}`);
  const event = {
    sequence: ++activitySequence,
    timestamp: new Date().toISOString(),
    type,
    source: boundedText(value.source, 64) ?? source
  };
  const fields = [
    ["moduleId", 128],
    ["featureId", 160],
    ["componentId", 160],
    ["symbol", 256],
    ["summary", 500],
    ["detail", 12000],
    ["command", 1200],
    ["tool", 300],
    ["status", 80],
    ["from", 200],
    ["to", 200],
    ["taskId", 160],
    ["orchestrationId", 160],
    ["orchestrationMode", 64]
  ];
  for (const [key, max] of fields) {
    const text = boundedText(value[key], max);
    if (text) event[key] = text;
  }
  const file = relativeCodePath(value.file);
  if (file) event.file = file;
  const test = relativeCodePath(value.test);
  if (test) event.test = test;
  if (value.usage && typeof value.usage === "object") {
    const numeric = (key) => {
      const number = Number(value.usage[key]);
      return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
    };
    event.usage = Object.freeze({
      inputTokens: numeric("inputTokens"),
      cachedInputTokens: numeric("cachedInputTokens"),
      cacheWriteInputTokens: numeric("cacheWriteInputTokens"),
      outputTokens: numeric("outputTokens"),
      reasoningOutputTokens: numeric("reasoningOutputTokens"),
      totalTokens: numeric("totalTokens")
    });
  }
  return Object.freeze(event);
}

function appendActivity(value, options) {
  const event = normalizeActivityEvent(value, options);
  const recorded = appendReplayEvent(ROOT, event);
  activityEvents.push(recorded);
  if (activityEvents.length > ACTIVITY_LIMIT) activityEvents.splice(0, activityEvents.length - ACTIVITY_LIMIT);
  recordVerificationEvent(ROOT, recorded);
  return recorded;
}

function activityPayload(after = 0) {
  const sequence = Number.isFinite(after) && after >= 0 ? Math.floor(after) : 0;
  return Object.freeze({
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    latestSequence: activitySequence,
    events: activityEvents.filter((event) => event.sequence > sequence)
  });
}

function statusPayload({ knowledge = loadKnowledge(), reposRoot = defaultReposRoot(knowledge.root) } = {}) {
  const modules = workspaceStatus({ knowledge, reposRoot }).map(publicStatus);
  return Object.freeze({
    mode: "local",
    generatedAt: new Date().toISOString(),
    snapshot: knowledge.snapshot,
    modules
  });
}

function createApiSnapshotCache({ knowledge, reposRoot }) {
  const now = () => Date.now();
  let status = null;
  let graph = null;
  let verification = null;

  function cached(entry, ttlMs, build) {
    if (entry && now() - entry.createdAt < ttlMs) return entry;
    return Object.freeze({ createdAt: now(), value: build() });
  }

  return Object.freeze({
    workspaceStatus() {
      status = cached(status, 12_000, () => statusPayload({ knowledge, reposRoot }));
      return status.value;
    },
    graphData() {
      graph ??= Object.freeze(buildGraphViewModel({ knowledge, index: loadCodeIndex({ knowledge }) }));
      return graph;
    },
    verificationState() {
      verification = cached(verification, 6_000, () => verificationStatePayload({
        workspaceRoot: knowledge.root,
        knowledge,
        verification: this.graphData().verification,
        changeIntelligence: loadChangeIntelligence(knowledge.root)
      }));
      return verification.value;
    },
    invalidateVerification() {
      verification = null;
    },
    invalidate() {
      status = null;
      graph = null;
      verification = null;
    }
  });
}

function graphReplayState(graph) {
  const ids = [
    ...(graph?.modules ?? []).map((entry) => entry.id),
    ...(graph?.features ?? []).map((entry) => entry.id),
    ...(graph?.components ?? []).map((entry) => entry.id),
    ...(graph?.verification?.tests ?? []).map((entry) => entry.id),
    ...(graph?.code?.nodes ?? []).map((entry) => entry.id)
  ].filter(Boolean);
  const relations = [
    ...(graph?.contracts ?? []).map((entry) => ({
      id: entry.id,
      from: entry.from,
      to: entry.to,
      type: entry.type
    })),
    ...(graph?.sharedCapabilities ?? []).map((entry) => ({
      id: entry.id,
      from: entry.providerFeatureId ?? entry.providerModuleId,
      to: entry.consumerFeatureId ?? entry.consumerModuleId,
      type: "shared-capability"
    })),
    ...(graph?.verification?.relations ?? []).map((entry) => ({
      id: entry.id,
      from: entry.from,
      to: entry.to,
      type: entry.type
    }))
  ].filter((entry) => entry.id && entry.from && entry.to);
  const relationEndpoints = relations.flatMap((entry) => [entry.from, entry.to]).filter(Boolean);
  return Object.freeze({
    schemaVersion: graph?.schemaVersion ?? null,
    generatedAt: graph?.generatedAt ?? null,
    entityIds: Object.freeze([...new Set([...ids, ...relationEndpoints])].sort()),
    relations: Object.freeze(relations)
  });
}

function replayFrame(sequence) {
  const knowledge = loadKnowledge();
  const index = loadCodeIndex({ knowledge });
  const graph = buildGraphViewModel({ knowledge, index });
  const frame = replayFramePayload(knowledge.root, sequence);
  const historicalVerification = replayVerificationStateAt(knowledge.root, frame.sequence);
  return Object.freeze({
    ...frame,
    verificationState: verificationStatePayloadFromState({
      state: historicalVerification,
      knowledge,
      verification: graph.verification,
      changeIntelligence: frame.changeIntelligence
    })
  });
}

function refreshWorkspaceChanges(requestedModules = [], activityContext = {}) {
  const knowledge = loadKnowledge();
  const reposRoot = defaultReposRoot(knowledge.root);
  const requested = (requestedModules ?? []).filter((id) => knowledge.moduleById.has(id));
  const beforeIndex = loadCodeIndex({ knowledge });
  const beforeGraph = buildGraphViewModel({ knowledge, index: beforeIndex });
  recordReplayCheckpoint(knowledge.root, {
    sequence: activitySequence,
    changeIntelligence: loadChangeIntelligence(knowledge.root),
    graphState: graphReplayState(beforeGraph)
  });
  const gitChanges = collectGitChanges({ knowledge, reposRoot, modules: requested });
  const refreshed = refreshCodeIndex({
    knowledge,
    reposRoot,
    modules: requested
  });
  const afterGraph = buildGraphViewModel({ knowledge, index: refreshed.index });
  const changeIntelligence = saveChangeIntelligence(
    knowledge.root,
    buildChangeIntelligence({
      knowledge,
      beforeGraph,
      afterGraph,
      gitChanges
    })
  );
  const rendered = renderGraphV2({ knowledge, index: refreshed.index });
  if (changeIntelligence.gitChanges.length || changeIntelligence.semanticDiff.changedEntityIds.length) {
    const changedModuleIds = [...new Set(changeIntelligence.gitChanges.map((entry) => entry.moduleId).filter(Boolean))];
    const changedFeatureIds = [...new Set(changeIntelligence.gitChanges.flatMap((entry) => entry.featureIds ?? []).filter(Boolean))];
    const changedComponentIds = [...new Set(changeIntelligence.gitChanges.flatMap((entry) => entry.componentIds ?? []).filter(Boolean))];
    const event = appendActivity({
      type: "git_diff_updated",
      source: "bridge",
      taskId: activityContext.taskId ?? null,
      moduleId: changedModuleIds.length === 1 ? changedModuleIds[0] : null,
      featureId: changedFeatureIds.length === 1 ? changedFeatureIds[0] : null,
      componentId: changedComponentIds.length === 1 ? changedComponentIds[0] : null,
      summary: `${changeIntelligence.gitChanges.length} files · ${changeIntelligence.semanticDiff.changedEntityIds.length} semantic entities · ${changeIntelligence.impact.impactedModules.length} impacted modules`
    }, { source: "bridge" });
    recordReplayCheckpoint(knowledge.root, {
      sequence: event.sequence,
      timestamp: event.timestamp,
      changeIntelligence,
      graphState: graphReplayState(afterGraph)
    });
  } else {
    recordReplayCheckpoint(knowledge.root, {
      sequence: activitySequence,
      changeIntelligence,
      graphState: graphReplayState(afterGraph)
    });
  }
  return Object.freeze({
    knowledge,
    reposRoot,
    refreshed,
    rendered,
    changeIntelligence
  });
}

async function readJsonBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > BODY_LIMIT) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeJoin(base, relativePath) {
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, "");
  const resolved = path.resolve(base, normalized);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return null;
  return resolved;
}

function staticFilePath(urlPath, flutterRoot = FLUTTER_WEB_ROOT) {
  const decoded = decodeURIComponent(urlPath);
  if (decoded === "/graph-v2.html") return path.join(ROOT, "graph-v2.html");
  if (decoded === "/legacy" || decoded === "/legacy/") return path.join(ROOT, "graph-v2.html");
  if (decoded.startsWith("/legacy/")) {
    const legacyRelative = decoded.slice("/legacy/".length);
    return safeJoin(ROOT, legacyRelative);
  }

  const flutterRelative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  return safeJoin(flutterRoot, flutterRelative);
}

function serveStatic(req, res, pathname, { flutterRoot = FLUTTER_WEB_ROOT } = {}) {
  const filePath = staticFilePath(pathname, flutterRoot);
  if (!filePath) {
    json(res, 403, { error: "forbidden" });
    return;
  }

  if (!fs.existsSync(flutterRoot) && !pathname.startsWith("/legacy") && pathname !== "/graph-v2.html") {
    json(res, 503, {
      error: "Flutter viewer build is missing",
      hint: "Run bash tools/remote/bridge.sh start so the remote controller can build viewer_flutter/build/web."
    });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    if (!pathname.startsWith("/legacy") && pathname !== "/graph-v2.html") {
      const fallback = path.join(flutterRoot, "index.html");
      if (fs.existsSync(fallback)) {
        const body = fs.readFileSync(fallback);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": body.length,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "cross-origin-opener-policy": "same-origin",
          "cross-origin-embedder-policy": "credentialless"
        });
        res.end(body);
        return;
      }
    }
    json(res, 404, { error: "not found" });
    return;
  }

  const finalPath = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
  try {
    const body = fs.readFileSync(finalPath);
    const type = MIME[path.extname(finalPath).toLowerCase()] ?? "application/octet-stream";
    const headers = {
      "content-type": type,
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    };
    if (!pathname.startsWith("/legacy") && pathname !== "/graph-v2.html") {
      headers["cross-origin-opener-policy"] = "same-origin";
      headers["cross-origin-embedder-policy"] = "credentialless";
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

async function handleApi(req, res, url, { agentAdapter, conversation, conversationToken, apiCache } = {}) {
  const pathname = url.pathname;
  const conversationTokenAccepted = sameSecret(conversationToken, bearerToken(req));

  async function submitPrompt(args, { source = "viewer", clientMessageId = null } = {}) {
    const settings = loadViewerSettings();
    if (!settings.promptEnabled) {
      return { status: 403, payload: { error: "prompt is disabled in viewer settings" } };
    }
    const prompt = boundedText(args.prompt, PROMPT_LIMIT);
    if (!prompt) {
      return { status: 400, payload: { error: "prompt is required" } };
    }
    const duplicate = clientMessageId ? conversation.submission(clientMessageId) : null;
    if (duplicate) {
      return {
        status: 202,
        payload: { status: "accepted", execution: "duplicate", event: null, task: null, conversation: duplicate }
      };
    }
    const conversationId = clientMessageId ?? `${source}:prompt:${Date.now()}:${activitySequence + 1}`;
    const conversationEntry = conversation.append({
      source,
      kind: "prompt",
      text: prompt,
      clientMessageId,
      conversationId
    }).entry;
    if (source === "viewer") conversation.clearDraft(args.clientId);
    const event = appendActivity({
      type: "prompt_submitted",
      source,
      moduleId: args.moduleId,
      featureId: args.featureId,
      summary: `Prompt submitted from ${source}`
    }, { source });
    const orchestration = buildOrchestrationPlan({
      query: prompt,
      moduleId: boundedText(args.moduleId, 128),
      featureId: boundedText(args.featureId, 160),
      knowledge: loadKnowledge()
    });
    const orchestrationId = `orchestration:${event.sequence}`;
    const orchestrationSummary = orchestrationPlanSummary(orchestration);
    appendActivity({
      type: "orchestration_planned",
      source: "bridge",
      moduleId: args.moduleId,
      featureId: args.featureId,
      orchestrationId,
      orchestrationMode: orchestration.mode,
      status: String(orchestration.score),
      summary: `${orchestration.mode} · score ${orchestration.score} · ${orchestrationSummary.subagents} subagents · ${orchestrationSummary.roles.join(", ") || "primary"}`
    }, { source: "bridge" });

    const adapterStatus = agentAdapter?.status?.();
    if (!agentAdapter || !adapterStatus?.available) {
      conversation.append({
        source: "workspace",
        kind: "status",
        text: "Prompt recorded, but the local Codex adapter is unavailable",
        conversationId: conversationEntry.conversationId
      });
      return {
        status: 202,
        payload: {
          status: "accepted",
          execution: "agent-adapter-unavailable",
          event,
          task: null,
          adapter: adapterStatus ?? null,
          orchestration,
          conversation: conversationEntry
        }
      };
    }

    try {
      const task = agentAdapter.dispatch({
        prompt,
        moduleId: args.moduleId,
        featureId: args.featureId,
        summary: event.summary,
        orchestrationPlan: orchestration
      });
      conversation.linkTask(task.id, conversationEntry.conversationId ?? task.id);
      return {
        status: 202,
        payload: {
          status: "accepted",
          execution: "codex",
          event,
          task,
          adapter: agentAdapter.status(),
          orchestration,
          conversation: conversationEntry
        }
      };
    } catch (error) {
      const code = error?.code;
      const status = code === "AGENT_BUSY" ? 409 : code === "INVALID_PROMPT" ? 400 : 503;
      conversation.append({
        source: "workspace",
        kind: "status",
        text: code === "AGENT_BUSY" ? "Codex is already working on another prompt" : "Codex could not start this prompt",
        status: code === "AGENT_BUSY" ? "busy" : "failed",
        conversationId: conversationEntry.conversationId
      });
      return {
        status,
        payload: {
          error: error instanceof Error ? error.message : String(error),
          execution: "not-started",
          event,
          adapter: agentAdapter.status(),
          orchestration,
          conversation: conversationEntry
        }
      };
    }
  }
  if (req.method === "GET" && pathname === "/api/health") {
    const adapterStatus = agentAdapter?.status?.() ?? {
      kind: "off",
      configured: false,
      available: false,
      busy: false
    };
    json(res, 200, {
      status: "ok",
      mode: "local",
      activitySchemaVersion: 3,
      verificationSchemaVersion: 1,
      replaySchemaVersion: 1,
      orchestrationSchemaVersion: 1,
      agentAdapterSchemaVersion: 1,
      promptExecution: adapterStatus.available ? adapterStatus.kind : "agent-adapter-required",
      agentAdapter: {
        kind: adapterStatus.kind,
        configured: adapterStatus.configured,
        available: adapterStatus.available,
        busy: adapterStatus.busy
      }
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/agent-adapter") {
    json(res, 200, agentAdapter?.status?.() ?? {
      schemaVersion: 1,
      kind: "off",
      configured: false,
      available: false,
      busy: false,
      reason: "agent adapter is not initialized",
      currentTask: null,
      lastTask: null
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/orchestration-plan") {
    const args = await readJsonBody(req);
    const query = boundedText(args.query ?? args.prompt, PROMPT_LIMIT);
    if (!query) {
      json(res, 400, { error: "query is required" });
      return true;
    }
    try {
      const plan = buildOrchestrationPlan({
        query,
        moduleId: boundedText(args.moduleId, 128),
        featureId: boundedText(args.featureId, 160),
        changedModules: Array.isArray(args.changedModules) ? args.changedModules : [],
        changedFiles: Array.isArray(args.changedFiles) ? args.changedFiles : [],
        knowledge: loadKnowledge()
      });
      json(res, 200, plan);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/workspace-status") {
    json(res, 200, apiCache.workspaceStatus());
    return true;
  }

  if (req.method === "GET" && pathname === "/api/graph-data") {
    json(res, 200, apiCache.graphData());
    return true;
  }

  if (req.method === "GET" && pathname === "/api/viewer-settings") {
    json(res, 200, loadViewerSettings());
    return true;
  }

  if (req.method === "POST" && pathname === "/api/viewer-settings") {
    const current = loadViewerSettings();
    const args = await readJsonBody(req);
    const next = saveViewerSettings({ ...current, ...args });
    json(res, 200, next);
    return true;
  }

  if (req.method === "GET" && pathname === "/api/change-intelligence") {
    const knowledge = loadKnowledge();
    const reposRoot = defaultReposRoot(knowledge.root);
    const saved = loadChangeIntelligence(knowledge.root);
    if (saved) {
      json(res, 200, saved);
      return true;
    }
    const graph = apiCache.graphData();
    const gitChanges = collectGitChanges({ knowledge, reposRoot });
    json(res, 200, buildChangeIntelligence({
      knowledge,
      beforeGraph: graph,
      afterGraph: graph,
      gitChanges
    }));
    return true;
  }

  if (req.method === "GET" && pathname === "/api/replay") {
    json(res, 200, replayTimelinePayload(ROOT));
    return true;
  }

  if (req.method === "GET" && pathname === "/api/replay/frame") {
    const raw = url.searchParams.get("sequence");
    const rawSequence = raw == null ? Number.NaN : Number(raw);
    json(res, 200, replayFrame(rawSequence));
    return true;
  }

  if (req.method === "GET" && pathname === "/api/verification-state") {
    json(res, 200, apiCache.verificationState());
    return true;
  }

  if (req.method === "GET" && pathname === "/api/activity") {
    const rawAfter = Number(url.searchParams.get("after") ?? 0);
    json(res, 200, activityPayload(rawAfter));
    return true;
  }

  if (req.method === "POST" && pathname === "/api/activity") {
    try {
      const args = await readJsonBody(req);
      const event = appendActivity(args, { source: "agent-adapter" });
      apiCache.invalidateVerification();
      json(res, 202, { status: "accepted", event });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/conversation") {
    if (!hasLoopbackConversationAccess(req) && !conversationTokenAccepted) {
      json(res, 403, { error: "conversation is available only to the loopback viewer or authenticated Discord transport" });
      return true;
    }
    json(res, 200, conversation.snapshot({ after: url.searchParams.get("after") ?? 0 }));
    return true;
  }

  if (req.method === "POST" && pathname === "/api/conversation/draft") {
    if (!hasLoopbackConversationAccess(req)) {
      json(res, 403, { error: "draft updates require the loopback viewer" });
      return true;
    }
    const settings = loadViewerSettings();
    if (!settings.promptEnabled) {
      json(res, 403, { error: "prompt is disabled in viewer settings" });
      return true;
    }
    try {
      const args = await readJsonBody(req);
      const draft = conversation.setDraft({ clientId: args.clientId, text: args.text });
      json(res, 202, { status: "accepted", draft, latestRevision: conversation.snapshot().latestRevision });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/conversation/prompt") {
    if (!conversationToken) {
      json(res, 503, { error: "Discord conversation transport is not configured" });
      return true;
    }
    if (!conversationTokenAccepted) {
      json(res, 401, { error: "Discord conversation transport is unauthorized" });
      return true;
    }
    const args = await readJsonBody(req);
    const result = await submitPrompt(args, {
      source: "discord",
      clientMessageId: boundedText(args.clientMessageId, 160)
    });
    json(res, result.status, result.payload);
    return true;
  }

  if (req.method === "POST" && pathname === "/api/conversation/cancel") {
    if (!conversationToken) {
      json(res, 503, { error: "Discord conversation transport is not configured" });
      return true;
    }
    if (!conversationTokenAccepted) {
      json(res, 401, { error: "Discord conversation transport is unauthorized" });
      return true;
    }
    const activeTask = agentAdapter?.status?.().currentTask ?? null;
    if (!activeTask) {
      json(res, 200, { status: "idle", task: null });
      return true;
    }
    agentAdapter.close("Cancelled from the allow-listed CodexDiscord interface");
    conversation.append({
      source: "workspace",
      kind: "status",
      text: "Codex task cancellation was requested from Discord",
      taskId: activeTask.id,
      status: "cancelled"
    });
    json(res, 202, { status: "cancelling", taskId: activeTask.id });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/conversation/status") {
    if (!conversationToken) {
      json(res, 503, { error: "Discord conversation transport is not configured" });
      return true;
    }
    if (!conversationTokenAccepted) {
      json(res, 401, { error: "Discord conversation transport is unauthorized" });
      return true;
    }
    const status = agentAdapter?.status?.() ?? { available: false, busy: false, currentTask: null, lastTask: null };
    json(res, 200, {
      available: status.available === true,
      busy: status.busy === true,
      currentTask: status.currentTask ?? null,
      lastTask: status.lastTask ?? null
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/prompt") {
    const args = await readJsonBody(req);
    const result = await submitPrompt(args, { source: "viewer" });
    json(res, result.status, result.payload);
    return true;
  }

  if (req.method === "POST" && pathname === "/api/refresh") {
    const args = await readJsonBody(req);
    const requested = Array.isArray(args.modules) ? args.modules : [];
    const result = refreshWorkspaceChanges(requested);
    apiCache.invalidate();
    json(res, 200, {
      status: "ok",
      generatedAt: result.rendered.generatedAt,
      freshness: result.refreshed.freshness,
      graph: result.rendered,
      changeIntelligence: result.changeIntelligence,
      workspace: apiCache.workspaceStatus()
    });
    return true;
  }

  return false;
}

export function createLocalViewerServer({
  flutterRoot = FLUTTER_WEB_ROOT,
  agentAdapter: providedAgentAdapter = null,
  agentEnv = process.env,
  conversation: providedConversation = null
} = {}) {
  const knowledge = loadKnowledge();
  const reposRoot = defaultReposRoot(knowledge.root);
  const conversation = providedConversation ?? createConversationSync();
  const conversationToken = boundedText(agentEnv.TOTEM_CONVERSATION_SYNC_TOKEN, 512);
  const apiCache = createApiSnapshotCache({ knowledge, reposRoot });
  const liveRefreshModules = new Set();
  let liveRefreshTaskId = null;
  let liveRefreshTimer = null;

  function enrichSemanticEdit(event) {
    if (!event || !["file_edit", "symbol_edit"].includes(event.type) || !event.moduleId || !event.file) return event;
    const activeKnowledge = loadKnowledge();
    const graph = buildGraphViewModel({
      knowledge: activeKnowledge,
      index: loadCodeIndex({ knowledge: activeKnowledge })
    });
    const mapped = mapGitChangesToSemantic([
      {
        moduleId: event.moduleId,
        repoName: activeKnowledge.moduleById.get(event.moduleId)?.repoName ?? event.moduleId,
        path: event.file,
        status: "M"
      }
    ], { beforeGraph: graph, afterGraph: graph })[0];
    return {
      ...event,
      componentId: event.componentId ?? (mapped?.componentIds?.length === 1 ? mapped.componentIds[0] : null),
      featureId: event.featureId ?? (mapped?.featureIds?.length === 1 ? mapped.featureIds[0] : null)
    };
  }

  function flushLiveRefresh() {
    if (liveRefreshTimer) {
      clearTimeout(liveRefreshTimer);
      liveRefreshTimer = null;
    }
    const modules = [...liveRefreshModules];
    const taskId = liveRefreshTaskId;
    liveRefreshModules.clear();
    liveRefreshTaskId = null;
    if (!modules.length) return;
    try {
      refreshWorkspaceChanges(modules, { taskId });
    } catch {
      // Live semantic refresh is best-effort; task completion still performs the final refresh.
    }
  }

  function scheduleLiveRefresh(moduleId, taskId) {
    if (!moduleId || !knowledge.moduleById.has(moduleId)) return;
    liveRefreshModules.add(moduleId);
    if (taskId) liveRefreshTaskId = taskId;
    if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
    liveRefreshTimer = setTimeout(flushLiveRefresh, 850);
  }

  const agentAdapter = providedAgentAdapter ?? createAgentAdapter({
    workspaceRoot: knowledge.root,
    reposRoot,
    knowledge,
    env: agentEnv,
    onActivity: (event) => {
      const enriched = enrichSemanticEdit(event);
      const recorded = appendActivity(enriched, { source: "codex-adapter" });
      apiCache.invalidateVerification();
      const progress = safeConversationProgress(recorded);
      if (progress) {
        conversation.append({
          source: "workspace",
          kind: "progress",
          text: progress.text,
          taskId: progress.taskId,
          status: progress.status
        });
      }
      if ((recorded.type === "file_edit" || recorded.type === "symbol_edit") && recorded.moduleId) {
        apiCache.invalidate();
        scheduleLiveRefresh(recorded.moduleId, recorded.taskId);
      }
      return recorded;
    },
    onTaskSettled: async (task) => {
      if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
      liveRefreshTimer = null;
      liveRefreshModules.clear();
      liveRefreshTaskId = null;
      refreshWorkspaceChanges([], { taskId: task?.id ?? null });
      apiCache.invalidate();
    }
  });
  const currentGraph = apiCache.graphData();
  const replayState = loadDevelopmentReplay(knowledge.root);
  if (!replayState.checkpoints.length) {
    recordReplayCheckpoint(knowledge.root, {
      sequence: replayState.latestSequence,
      changeIntelligence: loadChangeIntelligence(knowledge.root),
      graphState: graphReplayState(currentGraph)
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const base = `http://${req.headers.host || `${DEFAULT_HOST}:${DEFAULT_PORT}`}`;
      const url = new URL(req.url || "/", base);
      if (url.pathname.startsWith("/api/")) {
        if (!prepareApiCors(req, res)) {
          json(res, 403, { error: "cross-origin access is restricted to approved TotemWorkspace or loopback clients" });
          return;
        }
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        if (await handleApi(req, res, url, { agentAdapter, conversation, conversationToken, apiCache })) return;
        json(res, 404, { error: "unknown api route" });
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { error: "method not allowed" });
        return;
      }
      serveStatic(req, res, url.pathname, { flutterRoot });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.totemShutdown = (reason = "Bridge shutdown interrupted active Codex task") => {
    if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
    agentAdapter?.close?.(reason);
  };
  server.on("close", () => server.totemShutdown());
  return server;
}

function parsePort(argv) {
  const inline = argv.find((arg) => arg.startsWith("--port="));
  const separate = argv.findIndex((arg) => arg === "--port");
  const raw = inline ? inline.slice("--port=".length) : separate >= 0 ? argv[separate + 1] : null;
  if (raw == null) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid --port: ${raw}`);
  return port;
}

export function startLocalViewer({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  if (host !== DEFAULT_HOST && host !== "::1") {
    throw new Error(`local viewer only accepts loopback hosts (${DEFAULT_HOST} or ::1)`);
  }
  const server = createLocalViewerServer();
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    process.stdout.write(`Totem live local viewer: http://${host}:${actualPort}/\n`);
    process.stdout.write("Reads sibling Totem repositories from this machine only. Press Ctrl+C to stop.\n");
  });
  return server;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const server = startLocalViewer({ port: parsePort(process.argv.slice(2)) });
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.totemShutdown?.(`Bridge received ${signal}; active Codex task interrupted`);
    server.close(() => process.exit(0));
    const timeout = setTimeout(() => process.exit(1), 3000);
    timeout.unref?.();
  };
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.once(signal, () => shutdown(signal));
  }
}
