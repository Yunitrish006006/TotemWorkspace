import path from "node:path";

const CODE_FILE = /\.(?:java|kt)$/i;
const GENERIC_PACKAGE_SEGMENTS = new Set([
  "com", "org", "net", "io", "dev", "me", "github", "minecraft", "fabric", "fabricmc", "totem",
  "impl", "internal", "common", "main", "java", "kotlin"
]);
const TECHNICAL_AREA_SEGMENTS = new Set([
  "api", "v1", "v2", "client", "server", "mixin", "mixins", "network", "networking", "registry",
  "config", "bootstrap", "command", "commands", "integration", "integrations", "impl", "internal"
]);

const SURFACE_LABELS = Object.freeze({
  entrypoints: "Entrypoints",
  api: "API / contracts",
  networking: "Networking",
  events: "Events / hooks",
  commands: "Commands",
  registries: "Registries / bootstrap",
  persistence: "Persistence / codecs",
  clientUi: "Client / UI",
  mixins: "Mixins",
  integrations: "External integrations"
});

function normalize(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function isProductionCode(filePath) {
  const value = normalize(filePath).toLowerCase();
  if (!CODE_FILE.test(value)) return false;
  if (!(value.startsWith("src/main/") || value.startsWith("src/client/"))) return false;
  return !value.includes("/test/") && !value.includes("/gametest/") && !value.includes("/generated/");
}

function fileLabel(filePath) {
  return path.posix.basename(normalize(filePath)).replace(/\.(?:java|kt)$/i, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function fileRecords(index) {
  if (!index?.chunks) return [];
  const byFile = new Map();
  for (const chunk of index.chunks) {
    if (!isProductionCode(chunk.path)) continue;
    const key = `${chunk.moduleId}\0${normalize(chunk.path)}`;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(chunk);
  }

  return [...byFile.values()].map((chunks) => {
    const sorted = [...chunks].sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
    const first = sorted[0];
    const text = sorted.map((chunk) => chunk.text ?? "").join("\n");
    const packageName = text.match(/\bpackage\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/)?.[1] ?? "";
    const imports = unique([...text.matchAll(/\bimport\s+(?:static\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$*][\w$*]*)*)\s*;/g)].map((match) => match[1]));
    const symbols = unique(sorted.flatMap((chunk) => chunk.symbols ?? []));
    return Object.freeze({
      moduleId: first.moduleId,
      repoName: first.repoName,
      path: normalize(first.path),
      label: fileLabel(first.path),
      packageName,
      imports: Object.freeze(imports),
      symbols: Object.freeze(symbols),
      text
    });
  });
}

function moduleTokens(module) {
  return unique([
    module.id,
    module.id.replaceAll("-", ""),
    module.id.replace(/^totem-/, ""),
    module.repoName,
    module.name
  ].map((value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")).filter((value) => value.length >= 4));
}

function packageRoot(records) {
  const packages = records
    .map((record) => record.packageName.split(".").filter(Boolean))
    .filter((parts) => parts.length >= 2);
  if (!packages.length) return "";

  const counts = new Map();
  for (const parts of packages) {
    for (let length = 2; length <= Math.min(5, parts.length); length += 1) {
      const prefix = parts.slice(0, length).join(".");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }

  const threshold = Math.max(1, Math.ceil(packages.length * 0.65));
  const eligible = [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([prefix, count]) => ({ prefix, count, depth: prefix.split(".").length }))
    .sort((a, b) => b.depth - a.depth || b.count - a.count || a.prefix.localeCompare(b.prefix));
  if (eligible.length) return eligible[0].prefix;

  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count, depth: prefix.split(".").length }))
    .sort((a, b) => b.count - a.count || b.depth - a.depth || a.prefix.localeCompare(b.prefix))[0]?.prefix ?? "";
}

function featureArea(record, module, ownRoot) {
  const moduleWords = new Set(moduleTokens(module));
  const segments = record.packageName.split(".").map((segment) => segment.toLowerCase()).filter(Boolean);
  const rootSegments = ownRoot.split(".").map((segment) => segment.toLowerCase()).filter(Boolean);
  const insideRoot = rootSegments.length > 0 && rootSegments.every((segment, index) => segments[index] === segment);
  const candidates = insideRoot ? segments.slice(rootSegments.length) : segments;

  for (const segment of candidates) {
    const compact = segment.replace(/[^a-z0-9]/g, "");
    if (!compact || GENERIC_PACKAGE_SEGMENTS.has(compact) || moduleWords.has(compact)) continue;
    if (TECHNICAL_AREA_SEGMENTS.has(compact)) continue;
    return compact;
  }

  return insideRoot ? "module-root" : "adapter";
}

function pathHas(record, segment) {
  return normalize(record.path).toLowerCase().includes(`/${segment.toLowerCase()}/`);
}

function isEntrypoint(record) {
  return /\b(?:ModInitializer|ClientModInitializer|DedicatedServerModInitializer)\b/.test(record.text) &&
    /\b(?:implements|:)\s+(?:ModInitializer|ClientModInitializer|DedicatedServerModInitializer)\b|\bonInitialize(?:Client)?\s*\(/.test(record.text);
}

function isApiSurface(record) {
  if (pathHas(record, "api")) return true;
  if (/(?:Api|API|Contract|Facade|Provider)$/.test(record.label)) return true;
  if (/(?:Bridge)$/.test(record.label) && /\bpublic\s+(?:final\s+)?(?:class|interface|record)\b/.test(record.text)) return true;
  return false;
}

function isNetworkingSurface(record) {
  if (pathHas(record, "network") || pathHas(record, "networking")) return true;
  if (/(?:Payload|Packet|Networking|Network|Sender|Receiver|Transport|Sync|Channel|Codec)$/.test(record.label)) return true;
  return /\b(?:ServerPlayNetworking|ClientPlayNetworking|PayloadTypeRegistry)\s*\./.test(record.text);
}

function isEventSurface(record) {
  if (pathHas(record, "event") || pathHas(record, "events")) return true;
  if (/(?:Event|Events|Callback|Callbacks|Hook|Hooks|Listener|Subscriber)$/.test(record.label)) return true;
  return /\b(?:ServerTickEvents|ClientTickEvents|ServerLifecycleEvents|UseBlockCallback|AttackBlockCallback|CommandRegistrationCallback)\b[\s\S]*?\.register\s*\(/.test(record.text) ||
    /\.EVENT\.register\s*\(/.test(record.text);
}

function isCommandSurface(record) {
  if (pathHas(record, "command") || pathHas(record, "commands")) return true;
  if (/(?:Command|Commands)$/.test(record.label)) return true;
  return /\bCommandRegistrationCallback\.EVENT\.register\s*\(|\b(?:CommandManager|Commands)\.literal\s*\(/.test(record.text);
}

function isRegistrySurface(record) {
  if (pathHas(record, "registry") || pathHas(record, "registries")) return true;
  if (/(?:Registry|Registries|Registration|Bootstrap)$/.test(record.label)) return true;
  return /\bRegistry\.register\s*\(/.test(record.text);
}

function isPersistenceSurface(record) {
  if (["persistence", "storage", "state"].some((segment) => pathHas(record, segment))) return true;
  if (/(?:SavedData|PersistentState|Store|Storage|Repository|Codec)$/.test(record.label)) return true;
  return /\b(?:extends\s+(?:SavedData|PersistentState)|DataComponents?\.|ComponentType\.<|Codec\s*<|NbtCompound|CompoundTag)\b/.test(record.text);
}

function isClientUiSurface(record) {
  if (/(?:Screen|HandledScreen|ScreenHandler|Menu|Renderer|Hud|Overlay)$/.test(record.label)) return true;
  return /\b(?:extends\s+(?:Screen|HandledScreen)|implements\s+HudRenderCallback|GuiGraphics|DrawContext)\b/.test(record.text);
}

function isMixinSurface(record) {
  return pathHas(record, "mixin") || pathHas(record, "mixins") || /@Mixin\s*\(/.test(record.text);
}

function integrationSignal(record) {
  return /https?:\/\//i.test(record.text) ||
    /\b(?:openai|cloudflare|trinkets|jade|modmenu|midnightlib)\b/i.test(record.text) ||
    /isModLoaded\s*\(\s*["'][^"']+["']\s*\)/.test(record.text);
}

function surfaceKeys(record) {
  const keys = [];
  if (isEntrypoint(record)) keys.push("entrypoints");
  if (isApiSurface(record)) keys.push("api");
  if (isNetworkingSurface(record)) keys.push("networking");
  if (isEventSurface(record)) keys.push("events");
  if (isCommandSurface(record)) keys.push("commands");
  if (isRegistrySurface(record)) keys.push("registries");
  if (isPersistenceSurface(record)) keys.push("persistence");
  if (isClientUiSurface(record)) keys.push("clientUi");
  if (isMixinSurface(record)) keys.push("mixins");
  return keys;
}

function surfaceItem(record) {
  return Object.freeze({
    label: record.label,
    path: record.path,
    package: record.packageName || null,
    symbols: Object.freeze(record.symbols.slice(0, 10))
  });
}

function externalImport(importName, ownPackagePrefix = "") {
  const value = importName.toLowerCase();
  if (ownPackagePrefix && value.startsWith(ownPackagePrefix.toLowerCase())) return false;
  return ![
    "java.", "javax.", "kotlin.", "net.minecraft.", "net.fabricmc.", "com.mojang.",
    "org.slf4j.", "org.jetbrains."
  ].some((prefix) => value.startsWith(prefix));
}

function targetModuleForImport(importName, modules, sourceModuleId) {
  const compact = importName.toLowerCase().replace(/[^a-z0-9]/g, "");
  let best = null;
  for (const module of modules) {
    if (module.id === sourceModuleId) continue;
    for (const token of moduleTokens(module)) {
      if (!compact.includes(token)) continue;
      if (!best || token.length > best.token.length) best = { moduleId: module.id, token };
    }
  }
  return best?.moduleId ?? null;
}

function moduleInventory(module, records, allModules) {
  const ownRoot = packageRoot(records);
  const surfaces = Object.fromEntries(Object.keys(SURFACE_LABELS).map((key) => [key, []]));
  const areas = new Map();
  const integrations = new Map();
  const integrationFiles = new Set();
  const crossImports = new Map();

  for (const record of records) {
    const areaKey = featureArea(record, module, ownRoot);
    if (!areas.has(areaKey)) areas.set(areaKey, { key: areaKey, files: [], symbols: [] });
    const area = areas.get(areaKey);
    area.files.push(record.path);
    area.symbols.push(...record.symbols);

    for (const key of surfaceKeys(record)) surfaces[key].push(surfaceItem(record));

    let hasExternalImport = false;
    for (const importName of record.imports) {
      const target = targetModuleForImport(importName, allModules, module.id);
      if (target) {
        if (!crossImports.has(target)) crossImports.set(target, { targetModuleId: target, imports: [], evidencePaths: [] });
        crossImports.get(target).imports.push(importName);
        crossImports.get(target).evidencePaths.push(record.path);
        continue;
      }
      if (!externalImport(importName, ownRoot)) continue;
      hasExternalImport = true;
      const root = importName.split(".").slice(0, 3).join(".");
      if (!integrations.has(root)) integrations.set(root, { packageRoot: root, imports: [], evidencePaths: [] });
      integrations.get(root).imports.push(importName);
      integrations.get(root).evidencePaths.push(record.path);
    }

    if (hasExternalImport || integrationSignal(record) || pathHas(record, "integration") || pathHas(record, "integrations")) {
      integrationFiles.add(record.path);
      surfaces.integrations.push(surfaceItem(record));
    }
  }

  const featureAreas = [...areas.values()]
    .map((area) => Object.freeze({
      key: area.key,
      label: area.key,
      fileCount: unique(area.files).length,
      representativePaths: Object.freeze(unique(area.files).slice(0, 6)),
      symbols: Object.freeze(unique(area.symbols).slice(0, 12))
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.key.localeCompare(b.key));

  const normalizedSurfaces = Object.fromEntries(Object.entries(surfaces).map(([key, items]) => [
    key,
    Object.freeze(unique(items.map((item) => item.path)).map((itemPath) => items.find((item) => item.path === itemPath)).sort((a, b) => a.path.localeCompare(b.path)))
  ]));

  return Object.freeze({
    moduleId: module.id,
    repoName: module.repoName,
    sourceScope: "production-code-only",
    packageRoot: ownRoot || null,
    productionFileCount: records.length,
    featureAreas: Object.freeze(featureAreas),
    surfaces: Object.freeze(normalizedSurfaces),
    integrations: Object.freeze([...integrations.values()].map((entry) => Object.freeze({
      packageRoot: entry.packageRoot,
      imports: Object.freeze(unique(entry.imports).slice(0, 12)),
      evidencePaths: Object.freeze(unique(entry.evidencePaths).slice(0, 8))
    })).sort((a, b) => a.packageRoot.localeCompare(b.packageRoot))),
    crossModuleImports: Object.freeze([...crossImports.values()].map((entry) => Object.freeze({
      targetModuleId: entry.targetModuleId,
      imports: Object.freeze(unique(entry.imports).slice(0, 12)),
      evidencePaths: Object.freeze(unique(entry.evidencePaths).slice(0, 8))
    })).sort((a, b) => a.targetModuleId.localeCompare(b.targetModuleId))),
    counts: Object.freeze({
      featureAreas: featureAreas.length,
      api: normalizedSurfaces.api.length,
      networking: normalizedSurfaces.networking.length,
      events: normalizedSurfaces.events.length,
      commands: normalizedSurfaces.commands.length,
      registries: normalizedSurfaces.registries.length,
      persistence: normalizedSurfaces.persistence.length,
      clientUi: normalizedSurfaces.clientUi.length,
      mixins: normalizedSurfaces.mixins.length,
      integrations: integrationFiles.size
    })
  });
}

export function buildCodeInventory({ knowledge, index } = {}) {
  const modules = knowledge?.modules ?? [];
  const records = fileRecords(index);
  const byModule = new Map();
  for (const record of records) {
    if (!byModule.has(record.moduleId)) byModule.set(record.moduleId, []);
    byModule.get(record.moduleId).push(record);
  }

  return Object.freeze({
    schemaVersion: 2,
    generatedAt: index?.generatedAt ?? knowledge?.snapshot?.date ?? null,
    sourceScope: "production-code-only",
    description: "Derived only from indexed production Java/Kotlin source. Curated feature descriptions and README text are not evidence for this inventory.",
    modules: Object.freeze(modules.map((module) => moduleInventory(module, byModule.get(module.id) ?? [], modules)))
  });
}

export { SURFACE_LABELS, isProductionCode };
