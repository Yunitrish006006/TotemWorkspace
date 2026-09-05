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
  ["totem-alchemy", "TotemAlchemy", "0.1.41", "main", "0056a0096dcdb06f03f870edbc9f6b56259a466d", "TotemAlchemy", ">=0.7.15 <0.8.0"],
  ["totem-automata", "TotemAutomata", "0.1.21", "master", "8c9b90bbffb64f4058ffc7978bad1798e8944779", "TotemAutomata", ">=0.7.14 <0.8.0"],
  ["totem-core", "TotemCore", "0.7.16", "master", "b0b57bc98a98140a1c12a660a33952ea61167278", "TotemCore", null],
  ["totem-discord-bridge", "TotemDiscordBridge", "0.1.8", "master", "6ef67ed58ebe3a6b9ee9a4d328c668ab93c17453", "TotemDiscordBridge", ">=0.7.0 <0.8.0"],
  ["totem-enchanting", "TotemEnchanting", "0.1.9", "main", "17719ec20eed31938107aa069986c32e5ce5b053", "TotemEnchanting", ">=0.7.0 <0.8.0"],
  ["totem-excavation", "TotemExcavation", "0.1.10", "master", "646f82e5961255dc1b28aee1f800463b55f70002", "TotemExcavation", ">=0.7.13 <0.8.0"],
  ["totem-locksmith", "TotemLocksmith", "0.1.8", "main", "d73112169e73e717f02ef4a068e5cbd2782eb5e7", "TotemLocksmith", ">=0.7.15 <0.8.0"],
  ["totem-nexus", "TotemNexus", "0.3.12", "master", "41ba0b2e11b0a5745f8b7ffb9c6d71e45d9288f7", "TotemNexus", ">=0.7.16 <0.8.0"],
  ["totem-remnant", "TotemRemnant", "0.2.18", "master", "c828f42cee767b98a69d2bebd532b63f322c3b0e", "TotemRemnant", ">=0.7.15 <0.8.0"],
  ["totem-vanilla-tweaks", "TotemVanillaTweaks", "0.1.21", "main", "5d2d352453ef6abd9f59ddac8b203d7d5c5d87af", "TotemVanillaTweaks", ">=0.7.14 <0.8.0"],
  ["totem-villagers", "TotemVillagers", "0.1.34", "main", "9798ee3578affc2624edfcfb2343ec7aa95405df", "TotemVillagers", ">=0.7.12 <0.8.0"]
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
  check(data.snapshot?.date === "2026-09-02", "快照日期必須是 2026-09-02");
  check(data.snapshot?.minecraft === "26.2", "Minecraft 基線必須是 26.2");
  check(data.snapshot?.java === 25, "Java 基線必須是 25");
  check(data.snapshot?.publicationStateInferred === false, "不得從原始碼快照推論發布狀態");

  const modules = Array.isArray(data.modules) ? data.modules : [];
  const ids = modules.map((module) => module.id);
  const activeModules = modules.filter((module) => module.active === true);
  check(activeModules.length >= expectedModules.length, "現役 Totem 模組不得少於目前已稽核基線；新增模組應由 registry 資料驅動");
  check(new Set(ids).size === ids.length, "模組 ID 必須唯一");
  check(modules.every((module) => typeof module.active === "boolean"), "每個模組都必須明確標示 active");
  check(activeModules.every((module) => module.id.startsWith("totem-")), "所有現役模組 ID 必須是 totem-* mod ID");
  check(!activeModules.some((module) => /deadrecall/i.test(`${module.id} ${module.name} ${module.repository}`)), "DeadRecall 不得列為現役模組");

  for (const module of activeModules) {
    check(typeof module.name === "string" && module.name.length > 0, `${module.id} 缺少名稱`);
    check(typeof module.repository === "string" && /^https:\/\/github\.com\//.test(module.repository), `${module.id} 缺少 GitHub repository URL`);
    check(typeof module.defaultBranch === "string" && module.defaultBranch.length > 0, `${module.id} 缺少預設分支`);
    check(typeof module.commit === "string" && /^[0-9a-f]{40}$/.test(module.commit), `${module.id} commit 必須是完整 SHA`);
    check(typeof module.role === "string" && module.role.length >= 12, `${module.id} 缺少清楚的現行定位`);
    check(Array.isArray(module.featureGroups), `${module.id} featureGroups 必須是陣列`);
    check(Array.isArray(module.declaredSuggests), `${module.id} declaredSuggests 必須是陣列`);
    check(Array.isArray(module.runtimeOptionalIntegrationIds), `${module.id} runtimeOptionalIntegrationIds 必須是陣列`);
    check(Array.isArray(module.observerProviders), `${module.id} observerProviders 必須是陣列`);
  }

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
  check(modules.find((module) => module.id === "totem-core")?.featureGroups.includes("無狀態世界輪廓 API"), "TotemCore 快照缺少世界輪廓 API 功能群");
  check(modules.find((module) => module.id === "totem-automata")?.featureGroups.includes("深度遮擋工作區與容器連線"), "TotemAutomata 快照缺少世界內視覺化功能群");
  check(modules.find((module) => module.id === "totem-excavation")?.featureGroups.includes("深度遮擋選區輪廓"), "TotemExcavation 快照缺少深度遮擋選區功能群");
  check(modules.find((module) => module.id === "totem-nexus")?.featureGroups.includes("傳送陣方塊診斷"), "TotemNexus 快照缺少傳送陣方塊診斷功能群");

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
  const activeMatch = html.match(/var activeModuleIds = (\[[\s\S]*?\]);\s*\n\s*var overviewNodeLayout/);
  const softMatch = html.match(/var softDependencyAudit = (\[[\s\S]*?\n  \]);\s*\n\s*var externalServiceAudit/);
  const serviceMatch = html.match(/var externalServiceAudit = (\[[\s\S]*?\n  \]);\s*\n\s*var moduleDetails/);
  check(Boolean(detailMatch && activeMatch && softMatch && serviceMatch), "index.html 缺少可稽核的模組或依賴資料");

  if (detailMatch && activeMatch) {
    const details = evaluateLiteral(detailMatch[1], "index.html moduleDetails");
    const activeIds = evaluateLiteral(activeMatch[1], "index.html activeModuleIds");
    if (details && activeIds) {
      check(activeIds.length === expectedModules.length && new Set(activeIds).size === activeIds.length, "curated index.html 必須保留目前已稽核基線模組；新增 registry 模組可先由 generated viewers 自動呈現");
      const branchCount = activeIds.reduce((total, id) => total + (details[id]?.branches?.length ?? 0), 0);
      check(branchCount === 58, "index.html 必須包含 58 個功能分支");
      check(details.core?.version === "0.7.16" && details.core.branches.some((branch) => branch.startsWith("世界輪廓 API：")), "index.html TotemCore 版本或世界輪廓分支不正確");
      check(details.automata?.version === "0.1.21"
        && details.automata.branches.some((branch) => branch.startsWith("採集區框線："))
        && details.automata.branches.some((branch) => branch.startsWith("容器連線：")),
      "index.html TotemAutomata 版本或視覺分支不正確");
      check(details.excavation?.version === "0.1.10" && details.excavation.branches.some((branch) => branch.startsWith("選區輪廓：")), "index.html TotemExcavation 版本或選區輪廓分支不正確");
      check(details.nexus?.version === "0.3.12" && details.nexus.branches.some((branch) => branch.startsWith("傳送陣診斷：")), "index.html TotemNexus 版本或傳送陣診斷分支不正確");
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
  check(/id="soft-overview"/.test(html) && /id="feature-toggle-buttons"/.test(html), "index.html 必須提供軟依賴總覽與父節點功能按鈕層");
  check(/function toggleFeatureOwner\(ownerId\)/.test(html)
    && /data-owner/.test(html)
    && /啟用此功能時可搭配的軟依賴模組/.test(html),
  "index.html 父節點功能按鈕必須能散開分支並呈現功能級軟依賴");
  check((html.match(/addEventListener\("pointerdown"[\s\S]{0,180}?event\.stopPropagation\(\)/g) ?? []).length >= 2,
    "父節點功能按鈕與功能卡片必須攔截拖曳 pointerdown，避免點擊被總圖拖曳取消");
  check(!/id="feature-branches-toggle"/.test(html), "index.html 不得保留一次展開全部分支的工具列按鈕");
}

function globRegex(pattern) {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${expression}$`);
}

function ignoreRules(directory, relative) {
  const file = path.join(directory, ".gitignore");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .filter((raw) => raw && !raw.startsWith("#"))
    .map((raw) => {
      const negated = raw.startsWith("!");
      const source = negated ? raw.slice(1) : raw;
      const directoryOnly = source.endsWith("/");
      const anchored = source.startsWith("/");
      const pattern = source.replace(/^\//, "").replace(/\/$/, "");
      return {
        negated,
        directoryOnly,
        base: relative.split(path.sep).join("/"),
        pattern,
        regex: globRegex(pattern)
      };
    })
    .filter((rule) => rule.pattern);
}

function ignoredByRules(relative, directory, rules) {
  const normalized = relative.split(path.sep).join("/");
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !directory) continue;
    const fromBase = rule.base && normalized.startsWith(`${rule.base}/`)
      ? normalized.slice(rule.base.length + 1)
      : normalized;
    const target = rule.pattern.includes("/") ? fromBase : path.posix.basename(fromBase);
    if (rule.regex.test(target)) ignored = !rule.negated;
  }
  return ignored;
}

function walk(directory, relative = "", inheritedRules = []) {
  const rules = [...inheritedRules, ...ignoreRules(directory, relative)];
  const entries = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name === ".git") continue;
    const childRelative = path.join(relative, item.name);
    if (ignoredByRules(childRelative, item.isDirectory(), rules)) continue;
    const childAbsolute = path.join(directory, item.name);
    entries.push({ relative: childRelative, absolute: childAbsolute, directory: item.isDirectory() });
    if (item.isDirectory()) entries.push(...walk(childAbsolute, childRelative, rules));
  }
  return entries;
}

// Security and publication checks cover tracked files plus unignored local files.
// Runtime state (for example .env, node_modules, .totem-index, and Flutter build
// caches) is intentionally excluded by .gitignore and must not make validation
// fail merely because the local developer service is running.
const entries = walk(root);
const forbiddenDirectories = new Set(["build", "dist", "out", "node_modules"]);
check(!entries.some((entry) => entry.relative.split(path.sep).some((segment) => forbiddenDirectories.has(segment))), "Repository 不得包含未忽略的 build／dist／out／node_modules 檔案");
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
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
];

function hasConcreteSecretAssignment(content) {
  const assignments = /(?:api[_-]?key|token|password|secret)\s*[:=]\s*(?:(["'])([A-Za-z0-9_./+:-]{16,})\1|([A-Za-z0-9_+/-]*\d[A-Za-z0-9_+/-]{19,}))/gi;
  for (const match of content.matchAll(assignments)) {
    const candidate = match[2] ?? match[3];
    if (/^(?:example|placeholder|redacted|none|null|false|true|replace|test)(?:[-_]|$)/i.test(candidate)) continue;
    return true;
  }
  return false;
}

for (const entry of entries) {
  if (entry.directory || entry.relative === "LICENSE") continue;
  const extension = path.extname(entry.relative).toLowerCase();
  if (!textExtensions.has(extension) && path.basename(entry.relative) !== ".gitignore") continue;
  const content = fs.readFileSync(entry.absolute, "utf8");
  check(!/\/(?:home|Users)\/[A-Za-z0-9._-]+\//.test(content) && !/[A-Za-z]:\\Users\\[^\\]+\\/.test(content), `${entry.relative} 含本機絕對路徑`);
  for (const pattern of secretPatterns) {
    check(!pattern.test(content), `${entry.relative} 疑似包含高可信度 secret`);
  }
  check(!hasConcreteSecretAssignment(content), `${entry.relative} 疑似包含高可信度 secret`);
}

if (failures.length > 0) {
  console.error(`TotemWorkspace validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`TotemWorkspace validation passed (${passed} checks).`);
