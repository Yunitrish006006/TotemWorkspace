#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphViewModel } from "../intelligence/code-graph.mjs";
import { loadCodeIndex, refreshCodeIndex } from "../intelligence/code-index.mjs";
import { defaultReposRoot, loadKnowledge, workspaceStatus } from "../intelligence/workspace-knowledge.mjs";
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
  "prompt_submitted",
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

let activitySequence = 0;
const activityEvents = [];

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
    ["status", 80],
    ["from", 200],
    ["to", 200],
    ["test", 256],
    ["taskId", 160]
  ];
  for (const [key, max] of fields) {
    const text = boundedText(value[key], max);
    if (text) event[key] = text;
  }
  const file = relativeCodePath(value.file);
  if (file) event.file = file;
  return Object.freeze(event);
}

function appendActivity(value, options) {
  const event = normalizeActivityEvent(value, options);
  activityEvents.push(event);
  if (activityEvents.length > ACTIVITY_LIMIT) activityEvents.splice(0, activityEvents.length - ACTIVITY_LIMIT);
  return event;
}

function activityPayload(after = 0) {
  const sequence = Number.isFinite(after) && after >= 0 ? Math.floor(after) : 0;
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    latestSequence: activitySequence,
    events: activityEvents.filter((event) => event.sequence > sequence)
  });
}

function statusPayload() {
  const knowledge = loadKnowledge();
  const reposRoot = defaultReposRoot(knowledge.root);
  const modules = workspaceStatus({ knowledge, reposRoot }).map(publicStatus);
  return Object.freeze({
    mode: "local",
    generatedAt: new Date().toISOString(),
    snapshot: knowledge.snapshot,
    modules
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
          "x-content-type-options": "nosniff"
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
    res.writeHead(200, {
      "content-type": type,
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    res.end(body);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/health") {
    json(res, 200, {
      status: "ok",
      mode: "local",
      activitySchemaVersion: 1,
      promptExecution: "agent-adapter-required"
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/workspace-status") {
    json(res, 200, statusPayload());
    return true;
  }

  if (req.method === "GET" && pathname === "/api/graph-data") {
    const knowledge = loadKnowledge();
    const index = loadCodeIndex({ knowledge });
    json(res, 200, buildGraphViewModel({ knowledge, index }));
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

  if (req.method === "GET" && pathname === "/api/activity") {
    const rawAfter = Number(url.searchParams.get("after") ?? 0);
    json(res, 200, activityPayload(rawAfter));
    return true;
  }

  if (req.method === "POST" && pathname === "/api/activity") {
    try {
      const args = await readJsonBody(req);
      const event = appendActivity(args, { source: "agent-adapter" });
      json(res, 202, { status: "accepted", event });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/prompt") {
    const settings = loadViewerSettings();
    if (!settings.promptEnabled) {
      json(res, 403, { error: "prompt is disabled in viewer settings" });
      return true;
    }
    const args = await readJsonBody(req);
    const prompt = boundedText(args.prompt, PROMPT_LIMIT);
    if (!prompt) {
      json(res, 400, { error: "prompt is required" });
      return true;
    }
    const event = appendActivity({
      type: "prompt_submitted",
      source: "viewer",
      moduleId: args.moduleId,
      featureId: args.featureId,
      summary: prompt.length <= 220 ? prompt : `${prompt.slice(0, 217)}...`
    }, { source: "viewer" });
    json(res, 202, {
      status: "accepted",
      execution: "agent-adapter-required",
      event
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/refresh") {
    const args = await readJsonBody(req);
    const knowledge = loadKnowledge();
    const requested = Array.isArray(args.modules) ? args.modules.filter((id) => knowledge.moduleById.has(id)) : [];
    const refreshed = refreshCodeIndex({
      knowledge,
      reposRoot: defaultReposRoot(knowledge.root),
      modules: requested
    });
    const rendered = renderGraphV2({ knowledge, index: refreshed.index });
    json(res, 200, {
      status: "ok",
      generatedAt: rendered.generatedAt,
      freshness: refreshed.freshness,
      graph: rendered,
      workspace: statusPayload()
    });
    return true;
  }

  return false;
}

export function createLocalViewerServer({ flutterRoot = FLUTTER_WEB_ROOT } = {}) {
  return http.createServer(async (req, res) => {
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
        if (await handleApi(req, res, url)) return;
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
  startLocalViewer({ port: parsePort(process.argv.slice(2)) });
}
