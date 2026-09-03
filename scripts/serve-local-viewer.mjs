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
const DEFAULT_PORT = 8765;
const BODY_LIMIT = 64 * 1024;

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

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath === "/" ? "/graph-v2.html" : urlPath);
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, "");
  const resolved = path.resolve(ROOT, normalized);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) return null;
  return resolved;
}

function serveStatic(req, res, pathname) {
  const filePath = safeFilePath(pathname);
  if (!filePath) {
    json(res, 403, { error: "forbidden" });
    return;
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
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

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    json(res, 200, { status: "ok", mode: "local" });
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

export function createLocalViewerServer() {
  return http.createServer(async (req, res) => {
    try {
      const base = `http://${req.headers.host || `${DEFAULT_HOST}:${DEFAULT_PORT}`}`;
      const url = new URL(req.url || "/", base);
      if (url.pathname.startsWith("/api/")) {
        if (await handleApi(req, res, url.pathname)) return;
        json(res, 404, { error: "unknown api route" });
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { error: "method not allowed" });
        return;
      }
      serveStatic(req, res, url.pathname);
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
