#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let passed = 0;

function check(condition, message) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function sameSet(actual, expected) {
  return actual.length === expected.length
    && expected.every((value) => actual.includes(value));
}

function evaluateLiteral(source, label) {
  try {
    return Function(`"use strict"; return (${source});`)();
  } catch (error) {
    failures.push(`${label} 無法解析：${error.message}`);
    return null;
  }
}

const expectedModules = [
  ["totem-alchemy", "TotemAlchemy", "0.1.40", "main", "0d90b905d5d53ff8275046ea93572d10a10bd8f2", "TotemAlchemy", ">=0.7.5 <0.8.0"],
  ["totem-automata", "TotemAutomata", "0.1.18", "master", "dc1f2b10369d96f2ee7e2a4d46d88a416e35c047", "TotemAutomata", ">=0.7.12 <0.8.0"],
  ["totem-core", "TotemCore", "0.7.12", "master", "270bac834839b2a9dcbf9fe067f6b22d4e6f7851", "TotemCore", null],
  ["totem-discord-bridge", "TotemDiscordBridge", "0.1.8", "master", "381ba9f3b0d2bad47a31061abec1981534c6c92c", "TotemDiscordBridge", ">=0.7.0 <0.8.0"],
  ["totem-enchanting", "TotemEnchanting", "0.1.9", "main", "96977007116cd47ca877a6af57f863e87f1b7875", "TotemEnchanting", ">=0.7.0 <0.8.0"],
  ["totem-excavation", "TotemExcavation", "0.1.8", "master", "1b6f861ff14630d7af7c04ed16a5f9d63910f8bd", "TotemExcavation", ">=0.7.0 <0.8.0"],
  ["totem-locksmith", "TotemLocksmith", "0.1.6", "main", "7b4005028279df31e96d7e8446e4293086595a25", "TotemLocksmith", ">=0.7.12 <0.8.0"],
  ["totem-nexus", "TotemNexus", "0.3.6", "master", "7cc019a113c9037eaa0f6818b1d7a8a044f90d5f", "TotemNexus", ">=0.7.12 <0.8.0"],
  ["totem-remnant", "TotemRemnant", "0.2.16", "master", "b7a8479f3d51456cf9be83d645d2c777097ac124", "TotemRemnant", ">=0.7.12 <0.8.0"],
  ["totem-vanilla-tweaks", "TotemVanillaTweaks", "0.1.20", "main", "a6ac2bfe57476a4db9692bca2e6be7687b624ae8", "TotemVanillaTweaks", ">=0.7.12 <0.8.0"],
  ["totem-villagers", "TotemVillagers", "0.1.33", "main", "c32faf6ffd5d9135f68a3915e1dfa7f31d09dad9", "TotemVillagers", ">=0.7.12 <0.8.0"]
].map(([id, name, version, branch, commit, repositoryName, coreDependency]) => ({
  id,
  name,
  version,
  branch,
  commit,
  repository: `https://github.com/Yunitrish006006/${repositoryName}`,
  coreDependency
}));

let data;
try {
  data = JSON.parse(read("data/modules.json"));
  passed += 1;
} catch (error) {
  failures.push(`data/modules.json 無法解析：${error.message}`);
  data = null;
}

if (data) {
  check(data.schemaVersion === 1, "modules.json schemaVersion 必須是 1");
  check(data.snapshot?.date === "2026-08-30", "快照日期必須是 2026-08-30");
  check(data.snapshot?.minecraft === "26.2", "Minecraft 基線必須是 26.2");
  check(data.snapshot?.java === 25, "Java 基線必須是 25");
  check(data.snapshot?.publicationStateInferred === false, "不得從原始碼快照推論發布狀態");

  const modules = Array.isArray(data.modules) ? data.modules : [];
  const ids = modules.map((module) => module.id);
  check(modules.length === 11, "必須恰好有 11 個現役 Totem 模組");
  check(new Set(ids).size === 11, "現役模組 ID 必須唯一");
  check(modules.every((module) => module.active === true), "11 個模組都必須明確標示 active=true");
  check(modules.every((module) => module.id.startsWith("totem-")), "所有現役模組 ID 必須是 totem-* mod ID");
  check(!modules.some((module) => /deadrecall/i.test(`${module.id} ${module.name} ${module.repository}`)), "DeadRecall 不得列為現役模組");

  for (const expected of expectedModules) {
    const actual = modules.find((module) => module.id === expected.id);
    check(Boolean(actual), `缺少模組 ${expected.id}`);
    if (!actual) continue;
    check(actual.name === expected.name, `${expected.id} 名稱不正確`);
    check(actual.version === expected.version, `${expected.id} 版本不正確`);
    check(actual.defaultBranch === expected.branch, `${expected.id} 預設分支不正確`);
    check(actual.commit === expected.commit && /^[0-9a-f]{40}$/.test(actual.commit), `${expected.id} commit 必須是指定完整 SHA`);
    check(actual.repository === expected.repository, `${expected.id} GitHub URL 不正確`);
    check(actual.coreDependency === expected.coreDependency, `${expected.id} TotemCore 範圍不正確`);
    check(typeof actual.role === "string" && actual.role.length >= 12, `${expected.id} 缺少清楚的現行定位`);
    check(Array.isArray(actual.featureGroups) && actual.featureGroups.length >= 4, `${expected.id} 缺少功能群組`);
    check(Array.isArray(actual.declaredSuggests), `${expected.id} declaredSuggests 必須是陣列`);
    check(Array.isArray(actual.runtimeOptionalIntegrationIds), `${expected.id} runtimeOptionalIntegrationIds 必須是陣列`);
    check(Array.isArray(actual.observerProviders), `${expected.id} observerProviders 必須是陣列`);
  }

  const audit = data.dependencyAudit ?? {};
  const suggests = Array.isArray(audit.fabricSuggests) ? audit.fabricSuggests : [];
  const runtime = Array.isArray(audit.runtimeOptional) ? audit.runtimeOptional : [];
  const services = Array.isArray(audit.externalOptionalServices) ? audit.externalOptionalServices : [];
  const suggestIds = ["automata-excavation", "villagers-remnant", "remnant-trinkets"];
  const runtimeIds = [
    "automata-remnant",
    "automata-locksmith",
    "remnant-nexus",
    "vanillatweaks-remnant-observer",
    "vanillatweaks-automata-observer",
    "vanillatweaks-nexus-observer",
    "vanillatweaks-locksmith-observer",
    "vanillatweaks-villagers-observer"
  ];
  const serviceIds = ["discordbridge-cloudflare-discord", "automata-openai-compatible"];

  check(sameSet(suggests.map((entry) => entry.id), suggestIds), "Fabric suggests 必須是指定的 3 條");
  check(sameSet(runtime.map((entry) => entry.id), runtimeIds), "runtime optional／compat 必須是指定的 8 條");
  check(sameSet(services.map((entry) => entry.id), serviceIds), "外部選配服務必須是指定的 2 條");
  check(new Set([...suggests, ...runtime, ...services].map((entry) => entry.id)).size === 13, "依賴 audit ID 不得重複");

  const exactSuggests = {
    "automata-excavation": ["totem-automata", "totem-excavation", ">=0.1.5"],
    "villagers-remnant": ["totem-villagers", "totem-remnant", ">=0.2.13"],
    "remnant-trinkets": ["totem-remnant", "trinkets_updated", ">=4.1.0-beta.2"]
  };
  for (const entry of suggests) {
    const expected = exactSuggests[entry.id];
    check(Boolean(expected) && entry.from === expected[0] && entry.to === expected[1] && entry.version === expected[2], `${entry.id} 方向或版本不正確`);
  }

  const declaredSuggestIds = modules.flatMap((module) => module.declaredSuggests);
  const declaredRuntimeIds = modules.flatMap((module) => module.runtimeOptionalIntegrationIds);
  check(sameSet(declaredSuggestIds, suggestIds), "模組 declaredSuggests 引用必須與 audit 完全一致");
  check(sameSet(declaredRuntimeIds, runtimeIds), "模組 runtime optional 引用必須與 audit 完全一致");

  const expectedProviders = [
    "automata_copper_golem@1",
    "locksmith_management@1",
    "nexus@2",
    "nexus_death_node_admin@1",
    "remnant_backpack@1",
    "villagers_woodcutter@1"
  ];
  const providers = modules.flatMap((module) => module.observerProviders)
    .map((provider) => `${provider.family}@${provider.protocol}`);
  check(sameSet(providers, expectedProviders), "Observer family／protocol 清單不正確");
  const nexusProvider = modules.find((module) => module.id === "totem-nexus")?.observerProviders
    .find((provider) => provider.family === "nexus");
  check(sameSet(nexusProvider?.variants ?? [], ["map", "map_legacy", "friends", "friends_legacy", "registration", "registration_legacy"]), "nexus v2 variants 不正確");

  const events = Array.isArray(audit.eventBusOptionalSubscribers) ? audit.eventBusOptionalSubscribers : [];
  check(events.length === 3 && events.every((entry) => entry.subscriber === "totem-discord-bridge"), "EventBus 選配訂閱關係必須獨立保存 3 組");
  check(!runtime.some((entry) => entry.to === "totem-discord-bridge"), "EventBus 訂閱不得算成模組軟依賴");
  check(audit.legacyCompatibility?.status === "stopped-maintenance"
    && audit.legacyCompatibility?.activeModule === false
    && audit.legacyCompatibility?.includedInActiveDependencyGraph === false,
  "DeadRecall 必須明確標示為停止維護且排除於現役圖");
}

const indexPath = path.join(root, "index.html");
check(fs.existsSync(indexPath), "缺少 index.html");
if (fs.existsSync(indexPath)) {
  const html = read("index.html");
  check(/Content-Security-Policy[^>]+default-src 'none'/i.test(html), "index.html 必須有阻擋外部資源的 CSP");
  check(/img-src data:/i.test(html), "index.html CSP 必須允許內嵌 data image");
  check(!/<script\b[^>]*\bsrc\s*=/i.test(html), "index.html 不得載入外部 script");
  check(!/<link\b[^>]*\bhref\s*=/i.test(html), "index.html 不得載入外部 stylesheet／icon");

  const externalAttribute = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .find((value) => /^(?:https?:)?\/\//i.test(value));
  const externalCss = [...html.matchAll(/(?:url\(|@import\s+)["']?([^"')\s]+)/gi)]
    .map((match) => match[1])
    .find((value) => /^(?:https?:)?\/\//i.test(value));
  check(!externalAttribute && !externalCss, "index.html 不得引用外部 HTTP(S) asset");

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  check(scripts.length > 0, "index.html 必須包含內嵌互動程式");
  for (const [index, match] of scripts.entries()) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    try {
      Function(match[2]);
      passed += 1;
    } catch (error) {
      failures.push(`index.html inline script ${index + 1} 語法錯誤：${error.message}`);
    }
  }

  const detailMatch = html.match(/var moduleDetails = (\{[\s\S]*?\n  \});\s*\n\s*var activeModuleIds/);
  const activeMatch = html.match(/var activeModuleIds = (\[[\s\S]*?\]);\s*\n\s*var featureLayout/);
  const softMatch = html.match(/var softDependencyAudit = (\[[\s\S]*?\n  \]);\s*\n\s*var externalServiceAudit/);
  const serviceMatch = html.match(/var externalServiceAudit = (\[[\s\S]*?\n  \]);\s*\n\s*var moduleDetails/);
  check(Boolean(detailMatch && activeMatch && softMatch && serviceMatch), "index.html 缺少可稽核的模組或依賴資料");

  if (detailMatch && activeMatch) {
    const details = evaluateLiteral(detailMatch[1], "index.html moduleDetails");
    const activeIds = evaluateLiteral(activeMatch[1], "index.html activeModuleIds");
    if (details && activeIds) {
      check(activeIds.length === 11 && new Set(activeIds).size === 11, "index.html 必須恰好包含 11 個現役模組");
      const branchCount = activeIds.reduce((total, id) => total + (details[id]?.branches?.length ?? 0), 0);
      check(branchCount === 53, "index.html 必須包含 53 個功能分支");
      check(Boolean(details.soft_overview) && /軟依賴總覽/.test(details.soft_overview.name), "index.html 必須包含軟依賴總覽");
    }
  }
  if (softMatch && serviceMatch) {
    const soft = evaluateLiteral(softMatch[1], "index.html softDependencyAudit");
    const external = evaluateLiteral(serviceMatch[1], "index.html externalServiceAudit");
    if (soft && external) {
      check(soft.length === 11, "index.html 必須包含 3+8 條軟依賴／compat audit");
      check(soft.filter((entry) => entry.classification.startsWith("A")).length === 3, "index.html Fabric suggests 數量必須是 3");
      check(soft.filter((entry) => entry.classification.startsWith("B")).length === 8, "index.html runtime compat 數量必須是 8");
      check(external.length === 2, "index.html 外部選配服務數量必須是 2");
    }
  }
  check(/id="soft-overview"/.test(html) && /id="feature-branches-toggle"/.test(html), "index.html 必須提供軟依賴總覽與功能分支按鈕");
}

function walk(directory, relative = "") {
  const entries = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name === ".git") continue;
    const childRelative = path.join(relative, item.name);
    const childAbsolute = path.join(directory, item.name);
    entries.push({ relative: childRelative, absolute: childAbsolute, directory: item.isDirectory() });
    if (item.isDirectory()) entries.push(...walk(childAbsolute, childRelative));
  }
  return entries;
}

const entries = walk(root);
const forbiddenDirectories = new Set(["build", "dist", "out", "node_modules"]);
check(!entries.some((entry) => entry.directory && forbiddenDirectories.has(path.basename(entry.relative))), "Repository 不得包含 build／dist／out／node_modules 目錄");
check(!entries.some((entry) => !entry.directory && /\.jar$/i.test(entry.relative)), "Repository 不得包含 JAR");

const markdownFiles = entries.filter((entry) => !entry.directory
  && (entry.relative === "README.md" || entry.relative.startsWith(`docs${path.sep}`))
  && entry.relative.endsWith(".md"));
for (const file of markdownFiles) {
  const content = fs.readFileSync(file.absolute, "utf8");
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, "");
    if (!target || target.startsWith("#") || /^(?:https?:|mailto:|data:)/i.test(target)) continue;
    target = target.split("#", 1)[0];
    const resolved = path.resolve(path.dirname(file.absolute), decodeURIComponent(target));
    check(resolved.startsWith(`${root}${path.sep}`) && fs.existsSync(resolved), `${file.relative} 的內部連結不存在：${target}`);
  }
}

const textExtensions = new Set(["", ".md", ".json", ".mjs", ".js", ".yml", ".yaml", ".html", ".txt", ".gitignore"]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?(?!example|placeholder|redacted|none|null|false|true|\*{4})[A-Za-z0-9_./+:-]{16,}/i
];

for (const entry of entries) {
  if (entry.directory || entry.relative === "LICENSE") continue;
  const extension = path.extname(entry.relative).toLowerCase();
  if (!textExtensions.has(extension) && path.basename(entry.relative) !== ".gitignore") continue;
  const content = fs.readFileSync(entry.absolute, "utf8");
  check(!/\/(?:home|Users)\/[A-Za-z0-9._-]+\//.test(content) && !/[A-Za-z]:\\Users\\[^\\]+\\/.test(content), `${entry.relative} 含本機絕對路徑`);
  for (const pattern of secretPatterns) {
    check(!pattern.test(content), `${entry.relative} 疑似包含高可信度 secret`);
  }
}

if (failures.length > 0) {
  console.error(`TotemWorkspace validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`TotemWorkspace validation passed (${passed} checks).`);
