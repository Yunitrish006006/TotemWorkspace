import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { defaultReposRoot, loadKnowledge, tokenize } from "./workspace-knowledge.mjs";

const INDEXED_EXTENSIONS = new Set([
  ".java", ".kt", ".kts", ".json", ".gradle", ".properties", ".md",
  ".yml", ".yaml", ".toml", ".js", ".mjs", ".xml"
]);
const INDEXED_BASENAMES = new Set(["build.gradle", "settings.gradle", "gradle.properties", "fabric.mod.json", "AGENTS.md", "README.md"]);
const IGNORED_DIRECTORIES = new Set([".git", ".gradle", "build", "out", "dist", "run", "logs", "node_modules"]);
const MAX_FILE_BYTES = 1_000_000;
const CHUNK_LINES = 100;
const CHUNK_OVERLAP = 20;

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function shouldIndex(filePath) {
  const basename = path.basename(filePath);
  if (INDEXED_BASENAMES.has(basename)) return true;
  return INDEXED_EXTENSIONS.has(path.extname(basename).toLowerCase());
}

function walkFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && shouldIndex(fullPath)) files.push(fullPath);
    }
  }
  return files;
}

function detectSymbols(lines) {
  const symbols = [];
  const patterns = [
    /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/,
    /\b(?:public|protected|private|static|final|synchronized|abstract|default|native|strictfp|\s)+[\w<>?,.\[\] ]+\s+([A-Za-z_$][\w$]*)\s*\(/,
    /\b(?:function|class)\s+([A-Za-z_$][\w$]*)/,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=]*=>/
  ];
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      symbols.push({ name: match[1], line: index + 1 });
      break;
    }
  });
  return symbols;
}

function chunkFile({ moduleId, repoName, repoPath, filePath, content }) {
  const lines = content.split(/\r?\n/);
  const symbols = detectSymbols(lines);
  const relativePath = path.relative(repoPath, filePath).replaceAll(path.sep, "/");
  const chunks = [];
  const step = Math.max(1, CHUNK_LINES - CHUNK_OVERLAP);
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + CHUNK_LINES);
    const text = lines.slice(start, end).join("\n");
    if (!text.trim()) continue;
    const chunkSymbols = symbols.filter((symbol) => symbol.line >= start + 1 && symbol.line <= end).map((symbol) => symbol.name);
    chunks.push(Object.freeze({
      id: sha256(`${moduleId}\0${relativePath}\0${start + 1}\0${end}\0${text}`).slice(0, 24),
      moduleId,
      repoName,
      path: relativePath,
      startLine: start + 1,
      endLine: end,
      symbols: Object.freeze(chunkSymbols),
      text
    }));
    if (end === lines.length) break;
  }
  return chunks;
}

export function buildCodeIndex({ knowledge = loadKnowledge(), reposRoot = defaultReposRoot(knowledge.root), outputPath = path.join(knowledge.root, ".totem-index", "code-index.json") } = {}) {
  const chunks = [];
  const modules = [];
  for (const module of knowledge.modules) {
    const repoPath = path.join(reposRoot, module.repoName);
    if (!fs.existsSync(repoPath)) {
      modules.push({ id: module.id, repoName: module.repoName, present: false, files: 0, chunks: 0 });
      continue;
    }
    const files = walkFiles(repoPath);
    let moduleChunks = 0;
    for (const filePath of files) {
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;
      let content;
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      const fileChunks = chunkFile({ moduleId: module.id, repoName: module.repoName, repoPath, filePath, content });
      chunks.push(...fileChunks);
      moduleChunks += fileChunks.length;
    }
    modules.push({ id: module.id, repoName: module.repoName, present: true, files: files.length, chunks: moduleChunks });
  }

  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workspaceSnapshot: knowledge.snapshot,
    reposRoot,
    modules,
    chunks
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(index)}\n`, "utf8");
  return index;
}

export function loadCodeIndex({ knowledge = loadKnowledge(), indexPath = path.join(knowledge.root, ".totem-index", "code-index.json") } = {}) {
  if (!fs.existsSync(indexPath)) return null;
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += Math.max(1, needle.length);
  }
  return count;
}

function scoreChunk(chunk, query, tokens, moduleBoost) {
  const text = chunk.text.toLowerCase();
  const pathText = chunk.path.toLowerCase();
  const symbols = chunk.symbols.map((symbol) => symbol.toLowerCase());
  const normalizedQuery = query.toLowerCase().trim();
  let score = moduleBoost;
  if (normalizedQuery && text.includes(normalizedQuery)) score += 18;
  for (const token of tokens) {
    const bodyCount = Math.min(4, countOccurrences(text, token));
    score += bodyCount * 1.5;
    if (pathText.includes(token)) score += 5;
    if (symbols.some((symbol) => symbol.includes(token))) score += 8;
  }
  return score;
}

export function searchCode(query, { knowledge = loadKnowledge(), modules = [], limit = 12, index = loadCodeIndex({ knowledge }) } = {}) {
  if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
  if (!index) {
    return Object.freeze({
      query,
      indexed: false,
      message: "Code index is missing. Run: node scripts/totem-intelligence.mjs build-index",
      results: Object.freeze([])
    });
  }
  const moduleSet = new Set((modules ?? []).filter(Boolean));
  const tokens = tokenize(query);
  const scored = [];
  for (const chunk of index.chunks ?? []) {
    if (moduleSet.size > 0 && !moduleSet.has(chunk.moduleId)) continue;
    const score = scoreChunk(chunk, query, tokens, moduleSet.has(chunk.moduleId) ? 6 : 0);
    if (score <= 0) continue;
    scored.push({ score, chunk });
  }
  scored.sort((a, b) => b.score - a.score || a.chunk.path.localeCompare(b.chunk.path));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 40));
  return Object.freeze({
    query,
    indexed: true,
    generatedAt: index.generatedAt ?? null,
    results: Object.freeze(scored.slice(0, safeLimit).map(({ score, chunk }) => Object.freeze({
      score: Number(score.toFixed(2)),
      moduleId: chunk.moduleId,
      repoName: chunk.repoName,
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      symbols: chunk.symbols,
      preview: chunk.text.slice(0, 1800)
    })))
  });
}
