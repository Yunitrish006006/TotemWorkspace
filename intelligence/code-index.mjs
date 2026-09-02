import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { defaultReposRoot, loadKnowledge, tokenize } from "./workspace-knowledge.mjs";

const INDEX_SCHEMA_VERSION = 2;
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
  return files.sort();
}

function git(repoPath, args) {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function repoState(repoPath) {
  const head = git(repoPath, ["rev-parse", "HEAD"]);
  const branch = git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = git(repoPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return {
    head,
    branch,
    worktreeFingerprint: porcelain === null ? null : sha256(porcelain)
  };
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

function scanModuleFiles(repoPath) {
  const files = [];
  for (const filePath of walkFiles(repoPath)) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    files.push({
      filePath,
      path: path.relative(repoPath, filePath).replaceAll(path.sep, "/"),
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs)
    });
  }
  return files;
}

function readIndexedFile({ module, repoPath, info, content = null }) {
  const text = content ?? fs.readFileSync(info.filePath, "utf8");
  const chunks = chunkFile({
    moduleId: module.id,
    repoName: module.repoName,
    repoPath,
    filePath: info.filePath,
    content: text
  });
  return {
    fileState: {
      moduleId: module.id,
      repoName: module.repoName,
      path: info.path,
      size: info.size,
      mtimeMs: info.mtimeMs,
      sha256: sha256(text)
    },
    chunks
  };
}

function moduleMetadata(module, { present, state = {}, files = 0, chunks = 0 }) {
  return {
    id: module.id,
    repoName: module.repoName,
    present,
    head: state.head ?? null,
    branch: state.branch ?? null,
    worktreeFingerprint: state.worktreeFingerprint ?? null,
    files,
    chunks
  };
}

function writeIndex(outputPath, index) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(index)}\n`, "utf8");
}

function indexShapeMatchesKnowledge(index, knowledge, reposRoot) {
  if (index?.schemaVersion !== INDEX_SCHEMA_VERSION) return false;
  if (!Array.isArray(index.fileStates) || !Array.isArray(index.chunks) || !Array.isArray(index.modules)) return false;
  if (path.resolve(index.reposRoot ?? "") !== path.resolve(reposRoot)) return false;
  const indexedModules = new Map(index.modules.map((module) => [module.id, module.repoName]));
  if (indexedModules.size !== knowledge.modules.length) return false;
  return knowledge.modules.every((module) => indexedModules.get(module.id) === module.repoName);
}

export function buildCodeIndex({ knowledge = loadKnowledge(), reposRoot = defaultReposRoot(knowledge.root), outputPath = path.join(knowledge.root, ".totem-index", "code-index.json") } = {}) {
  const chunks = [];
  const fileStates = [];
  const modules = [];

  for (const module of knowledge.modules) {
    const repoPath = path.join(reposRoot, module.repoName);
    if (!fs.existsSync(repoPath)) {
      modules.push(moduleMetadata(module, { present: false }));
      continue;
    }

    const state = repoState(repoPath);
    const files = scanModuleFiles(repoPath);
    let moduleChunks = 0;
    for (const info of files) {
      let indexed;
      try {
        indexed = readIndexedFile({ module, repoPath, info });
      } catch {
        continue;
      }
      fileStates.push(indexed.fileState);
      chunks.push(...indexed.chunks);
      moduleChunks += indexed.chunks.length;
    }
    modules.push(moduleMetadata(module, {
      present: true,
      state,
      files: fileStates.filter((entry) => entry.moduleId === module.id).length,
      chunks: moduleChunks
    }));
  }

  const index = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    workspaceSnapshot: knowledge.snapshot,
    reposRoot,
    modules,
    fileStates,
    chunks
  };
  writeIndex(outputPath, index);
  return index;
}

export function loadCodeIndex({ knowledge = loadKnowledge(), indexPath = path.join(knowledge.root, ".totem-index", "code-index.json") } = {}) {
  if (!fs.existsSync(indexPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return null;
  }
}

export function refreshCodeIndex({
  knowledge = loadKnowledge(),
  reposRoot = defaultReposRoot(knowledge.root),
  indexPath = path.join(knowledge.root, ".totem-index", "code-index.json"),
  modules = [],
  forceFull = false
} = {}) {
  const requested = [...new Set((modules ?? []).filter(Boolean))];
  for (const moduleId of requested) {
    if (!knowledge.moduleById.has(moduleId)) throw new Error(`Unknown Totem module: ${moduleId}`);
  }

  const previous = loadCodeIndex({ knowledge, indexPath });
  if (forceFull || !indexShapeMatchesKnowledge(previous, knowledge, reposRoot)) {
    const reason = forceFull ? "forced" : previous ? "schema-or-workspace-change" : "missing-index";
    const index = buildCodeIndex({ knowledge, reposRoot, outputPath: indexPath });
    return {
      index,
      freshness: Object.freeze({
        mode: "full",
        reason,
        checkedModules: Object.freeze(knowledge.modules.map((module) => module.id)),
        refreshedModules: Object.freeze(knowledge.modules.filter((module) => index.modules.find((entry) => entry.id === module.id)?.present).map((module) => module.id)),
        changedFiles: null,
        removedFiles: null
      })
    };
  }

  const targets = requested.length > 0
    ? knowledge.modules.filter((module) => requested.includes(module.id))
    : knowledge.modules;
  let chunks = [...previous.chunks];
  let fileStates = [...previous.fileStates];
  const moduleMap = new Map(previous.modules.map((module) => [module.id, { ...module }]));
  const refreshedModules = [];
  const changedFiles = [];
  const removedFiles = [];
  let metadataChanged = false;

  for (const module of targets) {
    const repoPath = path.join(reposRoot, module.repoName);
    const oldMeta = moduleMap.get(module.id) ?? moduleMetadata(module, { present: false });

    if (!fs.existsSync(repoPath)) {
      const hadData = oldMeta.present || fileStates.some((entry) => entry.moduleId === module.id);
      if (hadData) {
        const removed = fileStates.filter((entry) => entry.moduleId === module.id).map((entry) => `${module.id}:${entry.path}`);
        removedFiles.push(...removed);
        chunks = chunks.filter((chunk) => chunk.moduleId !== module.id);
        fileStates = fileStates.filter((entry) => entry.moduleId !== module.id);
        refreshedModules.push(module.id);
      }
      const nextMeta = moduleMetadata(module, { present: false });
      if (JSON.stringify(nextMeta) !== JSON.stringify(oldMeta)) metadataChanged = true;
      moduleMap.set(module.id, nextMeta);
      continue;
    }

    const state = repoState(repoPath);
    const infos = scanModuleFiles(repoPath);
    const currentByPath = new Map(infos.map((info) => [info.path, info]));
    const oldStates = fileStates.filter((entry) => entry.moduleId === module.id);
    const oldByPath = new Map(oldStates.map((entry) => [entry.path, entry]));
    const contentCache = new Map();
    const changedPaths = new Set();
    const deletedPaths = new Set();
    const repoIdentityChanged = oldMeta.head !== state.head
      || oldMeta.branch !== state.branch
      || oldMeta.worktreeFingerprint !== state.worktreeFingerprint;

    for (const info of infos) {
      const old = oldByPath.get(info.path);
      if (!old || old.size !== info.size || old.mtimeMs !== info.mtimeMs) {
        changedPaths.add(info.path);
        continue;
      }
      if (repoIdentityChanged) {
        try {
          const content = fs.readFileSync(info.filePath, "utf8");
          contentCache.set(info.path, content);
          if (sha256(content) !== old.sha256) changedPaths.add(info.path);
        } catch {
          changedPaths.add(info.path);
        }
      }
    }

    for (const old of oldStates) {
      if (!currentByPath.has(old.path)) deletedPaths.add(old.path);
    }

    const touchedPaths = new Set([...changedPaths, ...deletedPaths]);
    if (touchedPaths.size > 0) {
      chunks = chunks.filter((chunk) => !(chunk.moduleId === module.id && touchedPaths.has(chunk.path)));
      fileStates = fileStates.filter((entry) => !(entry.moduleId === module.id && touchedPaths.has(entry.path)));

      for (const relativePath of changedPaths) {
        const info = currentByPath.get(relativePath);
        if (!info) continue;
        try {
          const indexed = readIndexedFile({ module, repoPath, info, content: contentCache.get(relativePath) ?? null });
          fileStates.push(indexed.fileState);
          chunks.push(...indexed.chunks);
          changedFiles.push(`${module.id}:${relativePath}`);
        } catch {
          removedFiles.push(`${module.id}:${relativePath}`);
        }
      }
      for (const relativePath of deletedPaths) removedFiles.push(`${module.id}:${relativePath}`);
      refreshedModules.push(module.id);
      metadataChanged = true;
    }

    const moduleFiles = fileStates.filter((entry) => entry.moduleId === module.id).length;
    const moduleChunks = chunks.filter((entry) => entry.moduleId === module.id).length;
    const nextMeta = moduleMetadata(module, { present: true, state, files: moduleFiles, chunks: moduleChunks });
    if (JSON.stringify(nextMeta) !== JSON.stringify(oldMeta)) metadataChanged = true;
    moduleMap.set(module.id, nextMeta);
  }

  const snapshotChanged = JSON.stringify(previous.workspaceSnapshot ?? {}) !== JSON.stringify(knowledge.snapshot ?? {});
  const shouldWrite = metadataChanged || snapshotChanged || refreshedModules.length > 0;
  const index = shouldWrite ? {
    ...previous,
    schemaVersion: INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    workspaceSnapshot: knowledge.snapshot,
    reposRoot,
    modules: knowledge.modules.map((module) => moduleMap.get(module.id) ?? moduleMetadata(module, { present: false })),
    fileStates: fileStates.sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.path.localeCompare(b.path)),
    chunks
  } : previous;

  if (shouldWrite) writeIndex(indexPath, index);

  return {
    index,
    freshness: Object.freeze({
      mode: refreshedModules.length > 0 ? "incremental" : "fresh",
      reason: refreshedModules.length > 0 ? "source-change-detected" : "no-source-change",
      checkedModules: Object.freeze(targets.map((module) => module.id)),
      refreshedModules: Object.freeze([...new Set(refreshedModules)]),
      changedFiles: Object.freeze(changedFiles),
      removedFiles: Object.freeze(removedFiles)
    })
  };
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

export function searchCode(query, {
  knowledge = loadKnowledge(),
  modules = [],
  limit = 12,
  index = null,
  indexPath = path.join(knowledge.root, ".totem-index", "code-index.json"),
  reposRoot = defaultReposRoot(knowledge.root),
  autoRefresh = true
} = {}) {
  if (typeof query !== "string" || !query.trim()) throw new Error("query is required");

  let activeIndex = index;
  let freshness = Object.freeze({ mode: "unchecked", reason: "explicit-index", checkedModules: Object.freeze([]), refreshedModules: Object.freeze([]), changedFiles: Object.freeze([]), removedFiles: Object.freeze([]) });
  if (!activeIndex && autoRefresh) {
    const refreshed = refreshCodeIndex({ knowledge, reposRoot, indexPath, modules });
    activeIndex = refreshed.index;
    freshness = refreshed.freshness;
  } else if (!activeIndex) {
    activeIndex = loadCodeIndex({ knowledge, indexPath });
  }

  if (!activeIndex) {
    return Object.freeze({
      query,
      indexed: false,
      freshness,
      message: "Code index is missing. Run: node scripts/totem-intelligence.mjs build-index",
      results: Object.freeze([])
    });
  }

  const moduleSet = new Set((modules ?? []).filter(Boolean));
  const tokens = tokenize(query);
  const scored = [];
  for (const chunk of activeIndex.chunks ?? []) {
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
    generatedAt: activeIndex.generatedAt ?? null,
    freshness,
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
