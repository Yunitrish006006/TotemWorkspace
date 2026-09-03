import path from "node:path";

const CODE_FILE = /\.(?:java|kt)$/i;
const GENERIC_PACKAGE_SEGMENTS = new Set([
  "com", "org", "net", "io", "dev", "me", "github", "minecraft", "fabric", "fabricmc",
  "impl", "internal", "common", "main", "java", "kotlin"
]);

const SURFACE_RULES = Object.freeze([
  ["entrypoints", /\b(?:ModInitializer|ClientModInitializer|DedicatedServerModInitializer)\b|\bonInitialize(?:Client)?\s*\(/],
  ["api", /(?:^|\/)api(?:\/|$)|\b(?:Api|API|Contract|Facade|Provider|Service|Lifecycle|Policy)\b/],
  ["networking", /\b(?:Payload|Packet|PacketCodec|CustomPayload|ServerPlayNetworking|ClientPlayNetworking|PayloadTypeRegistry|Networking)\b/],
  ["events", /\b(?:Event|Callback|EventBus|ServerTickEvents|ClientTickEvents|UseBlockCallback|AttackBlockCallback|ServerLifecycleEvents)\b/],
  ["commands", /\b(?:CommandRegistrationCallback|CommandManager|Commands\.literal|literal\s*\(|brigadier)\b/i],
  ["registries", /\b(?:Registry\.register|Registries\.|RegistryKey|RegistryKeys|RegistryEntry|register\s*\()\b/],
  ["persistence", /\b(?:SavedData|PersistentState|DataComponent|ComponentType|Codec|PacketCodec|Nbt|NBT|Storage|Store)\b/],
  ["clientUi", /\b(?:Screen|HandledScreen|ScreenHandler|Menu|HudRenderCallback|Renderer|GuiGraphics|DrawContext)\b/],
  ["mixins", /(?:^|\/)mixin(?:s)?(?:\/|$)|@Mixin\s*\(/i],
  ["integrations", /\b(?:Jade|Trinkets|ModMenu|MidnightLib|OpenAI|Discord|Cloudflare|HttpClient|HttpRequest|WebSocket)\b/i]
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

function featureArea(record, module) {
  const moduleWords = new Set(moduleTokens(module));
  const segments = record.packageName.split(".").map((segment) => segment.toLowerCase()).filter(Boolean);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const compact = segment.replace(/[^a-z0-9]/g, "");
    if (!compact || GENERIC_PACKAGE_SEGMENTS.has(compact) || moduleWords.has(compact)) continue;
    if (["api", "client", "mixin", "network", "networking", "registry", "config"].includes(compact)) continue;
    return compact;
  }

  const stripped = record.label
    .replace(/(?:Manager|Service|Registry|Handler|Controller|Screen|Renderer|Mixin|Payload|Packet|Api|API|Client|Server|Mod|Impl)$/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toLowerCase();
  return stripped || "core";
}

function surfaceKeys(record) {
  const haystack = `${record.path}\n${record.packageName}\n${record.label}\n${record.text}`;
  return SURFACE_RULES.filter(([, pattern]) => pattern.test(haystack)).map(([key]) => key);
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

function packageRoot(records) {
  const counts = new Map();
  for (const record of records) {
    const parts = record.packageName.split(".").filter(Boolean);
    if (parts.length < 2) continue;
    for (const length of [Math.min(5, parts.length), Math.min(4, parts.length), Math.min(3, parts.length)]) {
      if (length < 2) continue;
      const prefix = parts.slice(0, length).join(".");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1 + length * 0.01);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? "";
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
  const crossImports = new Map();

  for (const record of records) {
    const areaKey = featureArea(record, module);
    if (!areas.has(areaKey)) areas.set(areaKey, { key: areaKey, files: [], symbols: [] });
    const area = areas.get(areaKey);
    area.files.push(record.path);
    area.symbols.push(...record.symbols);

    for (const key of surfaceKeys(record)) surfaces[key].push(surfaceItem(record));

    for (const importName of record.imports) {
      const target = targetModuleForImport(importName, allModules, module.id);
      if (target) {
        if (!crossImports.has(target)) crossImports.set(target, { targetModuleId: target, imports: [], evidencePaths: [] });
        crossImports.get(target).imports.push(importName);
        crossImports.get(target).evidencePaths.push(record.path);
      }
      if (!externalImport(importName, ownRoot)) continue;
      const root = importName.split(".").slice(0, 3).join(".");
      if (!integrations.has(root)) integrations.set(root, { packageRoot: root, imports: [], evidencePaths: [] });
      integrations.get(root).imports.push(importName);
      integrations.get(root).evidencePaths.push(record.path);
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
    Object.freeze(items.sort((a, b) => a.path.localeCompare(b.path)))
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
      integrations: normalizedSurfaces.integrations.length
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
    schemaVersion: 1,
    generatedAt: index?.generatedAt ?? knowledge?.snapshot?.date ?? null,
    sourceScope: "production-code-only",
    description: "Derived only from indexed production Java/Kotlin source. Curated feature descriptions and README text are not evidence for this inventory.",
    modules: Object.freeze(modules.map((module) => moduleInventory(module, byModule.get(module.id) ?? [], modules)))
  });
}

export { SURFACE_LABELS, isProductionCode };
