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
const GENERIC_LABEL_WORDS = new Set([
  "client", "server", "screen", "screens", "payload", "payloads", "mixin", "mixins", "accessor",
  "manager", "service", "handler", "registry", "registration", "provider", "adapter", "support", "policy",
  "state", "data", "implementation", "impl", "event", "events", "hook", "hooks", "codec",
  "item", "items", "inventory", "content"
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

function identifierWords(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
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

function moduleNamespaceTokens(module) {
  const suffix = String(module.id ?? "").toLowerCase().replace(/^totem-/, "");
  const parts = suffix.split("-").map((part) => part.replace(/[^a-z0-9]/g, "")).filter((part) => part.length >= 4);
  return unique([...parts, suffix.replace(/[^a-z0-9]/g, "")]);
}

function moduleLabelWords(module) {
  return new Set(unique([
    ...moduleTokens(module),
    ...identifierWords(module.id),
    ...identifierWords(module.repoName),
    ...identifierWords(module.name)
  ]));
}

function semanticLabelWords(label, module) {
  const moduleWords = moduleLabelWords(module);
  return unique(identifierWords(label).filter((word) =>
    word.length >= 3
    && !moduleWords.has(word)
    && !GENERIC_PACKAGE_SEGMENTS.has(word)
    && !TECHNICAL_AREA_SEGMENTS.has(word)
    && !GENERIC_LABEL_WORDS.has(word)
  ));
}

function semanticRecordWords(record, module) {
  return unique([
    ...semanticLabelWords(record.label, module),
    ...record.symbols.flatMap((symbol) => semanticLabelWords(symbol, module))
  ]);
}

function fallbackPackageRoot(records) {
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

function packageRoot(records, module) {
  const namespaceTokens = new Set(moduleNamespaceTokens(module));
  const roots = new Map();
  let packageCount = 0;

  for (const record of records) {
    const parts = record.packageName.split(".").filter(Boolean);
    if (parts.length < 2) continue;
    packageCount += 1;
    for (let index = 0; index < parts.length; index += 1) {
      const compact = parts[index].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!namespaceTokens.has(compact)) continue;
      const root = parts.slice(0, index + 1).join(".");
      roots.set(root, (roots.get(root) ?? 0) + 1);
      break;
    }
  }

  if (roots.size) {
    const threshold = Math.max(1, Math.ceil(packageCount * 0.45));
    const best = [...roots.entries()]
      .map(([root, count]) => ({ root, count, depth: root.split(".").length }))
      .filter((entry) => entry.count >= threshold)
      .sort((a, b) => b.count - a.count || b.depth - a.depth || a.root.localeCompare(b.root))[0];
    if (best) return best.root;
  }

  return fallbackPackageRoot(records);
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

function featureAreaAssignments(records, module, ownRoot) {
  const explicit = new Map(records.map((record) => [record.path, featureArea(record, module, ownRoot)]));
  const knownAreas = unique([...explicit.values()].filter((area) => area !== "module-root" && area !== "adapter"));
  const vocabularies = new Map(knownAreas.map((area) => [area, new Set([area])]));

  for (const record of records) {
    const area = explicit.get(record.path);
    if (!vocabularies.has(area)) continue;
    for (const word of semanticRecordWords(record, module)) vocabularies.get(area).add(word);
  }

  const assignments = new Map();
  for (const record of records) {
    const baseArea = explicit.get(record.path);
    if (baseArea !== "module-root" || knownAreas.length === 0) {
      assignments.set(record.path, baseArea);
      continue;
    }

    const words = semanticRecordWords(record, module);
    const scored = knownAreas.map((area) => {
      const vocabulary = vocabularies.get(area);
      const overlap = words.filter((word) => vocabulary.has(word)).length;
      const areaBonus = words.includes(area) ? 3 : 0;
      return { area, score: overlap + areaBonus };
    }).filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.area.localeCompare(b.area));

    if (scored.length > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
      assignments.set(record.path, scored[0].area);
    } else {
      assignments.set(record.path, baseArea);
    }
  }
  return assignments;
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
  return /(?:Api|API|Contract|Facade)$/.test(record.label);
}

function isNetworkingSurface(record) {
  if (pathHas(record, "network") || pathHas(record, "networking")) return true;
  if (/(?:Payload|Packet|Networking|Network|Sender|Receiver|Transport|Sync|Channel|Codec)$/.test(record.label)) return true;
  return /\b(?:ServerPlayNetworking|ClientPlayNetworking|PayloadTypeRegistry)\s*\./.test(record.text);
}

function isEventSurface(record) {
  if (pathHas(record, "event") || pathHas(record, "events")) return true;
  if (/(?:Event|Events|Callback|Callbacks|Hook|Hooks|Listener|Subscriber)$/.test(record.label)) return true;
  return /\b(?:ServerTickEvents|ClientTickEvents|ServerLifecycleEvents|ServerPlayConnectionEvents|UseBlockCallback|AttackBlockCallback|CommandRegistrationCallback)\b[\s\S]*?\.register\s*\(/.test(record.text) ||
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
  if (/\b(?:extends\s+(?:SavedData|PersistentState)|DataComponents?\.CUSTOM_DATA\b|ComponentType\.<|Codec\s*<|NbtCompound|CompoundTag|ValueInput|ValueOutput|saveAdditional\s*\(|loadAdditional\s*\()/.test(record.text)) return true;
  return /\bString\s+encode\s*\(\s*\)/.test(record.text)
    && /\bstatic\s+[A-Za-z_$][\w$<>?.]*\s+decode\s*\(\s*String\b/.test(record.text);
}

function isClientUiSurface(record) {
  if (/(?:Screen|ScreenClient|UiClient|HandledScreen|ScreenHandler|Menu|Renderer|Hud|Overlay|Tooltip|ColorProvider)$/.test(record.label)) return true;
  return /\bextends\s+[A-Za-z_$][\w$]*Screen\b/.test(record.text)
    || /\b(?:implements\s+HudRenderCallback|GuiGraphics|DrawContext)\b/.test(record.text)
    || /\b(?:setScreenAndShow|setScreen)\s*\(/.test(record.text)
    || /\bgameRenderer\.displayItemActivation\s*\(/.test(record.text);
}

function isMixinSurface(record) {
  return pathHas(record, "mixin") || pathHas(record, "mixins") || /@Mixin\s*\(/.test(record.text);
}

function integrationSignal(record) {
  if (pathHas(record, "integration") || pathHas(record, "integrations") || pathHas(record, "compat")) return true;
  if (/\bFabricLoader\.getInstance\(\)\.isModLoaded\s*\(/.test(record.text) || /\bisModLoaded\s*\(\s*["'][^"']+["']\s*\)/.test(record.text)) return true;
  if (/\b(?:HttpClient|HttpRequest|WebSocket)\b/.test(record.text) || /https?:\/\//i.test(record.text)) return true;
  return /\b(?:Jade|TrinketsApi|TrinketsCompat|OpenAI|Cloudflare)\b/.test(record.text);
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
  if (integrationSignal(record)) keys.push("integrations");
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

function targetModuleForImport(importName, modulePackageRoots, sourceModuleId) {
  const value = importName.toLowerCase();
  let best = null;
  for (const [moduleId, packagePrefix] of modulePackageRoots) {
    if (moduleId === sourceModuleId || !packagePrefix) continue;
    const root = packagePrefix.toLowerCase();
    if (value !== root && !value.startsWith(`${root}.`)) continue;
    if (!best || root.length > best.root.length) best = { moduleId, root };
  }
  return best?.moduleId ?? null;
}

function moduleInventory(module, records, modulePackageRoots) {
  const ownRoot = modulePackageRoots.get(module.id) ?? packageRoot(records, module);
  const areaAssignments = featureAreaAssignments(records, module, ownRoot);
  const surfaces = Object.fromEntries(Object.keys(SURFACE_LABELS).map((key) => [key, []]));
  const areas = new Map();
  const integrations = new Map();
  const crossImports = new Map();

  for (const record of records) {
    const areaKey = areaAssignments.get(record.path) ?? featureArea(record, module, ownRoot);
    if (!areas.has(areaKey)) areas.set(areaKey, { key: areaKey, files: [], symbols: [] });
    const area = areas.get(areaKey);
    area.files.push(record.path);
    area.symbols.push(...record.symbols);

    for (const key of surfaceKeys(record)) surfaces[key].push(surfaceItem(record));

    for (const importName of record.imports) {
      const target = targetModuleForImport(importName, modulePackageRoots, module.id);
      if (target) {
        if (!crossImports.has(target)) crossImports.set(target, { targetModuleId: target, imports: [], evidencePaths: [] });
        crossImports.get(target).imports.push(importName);
        crossImports.get(target).evidencePaths.push(record.path);
        continue;
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
  const modulePackageRoots = new Map(modules.map((module) => [
    module.id,
    packageRoot(byModule.get(module.id) ?? [], module)
  ]));

  return Object.freeze({
    schemaVersion: 3,
    generatedAt: index?.generatedAt ?? knowledge?.snapshot?.date ?? null,
    sourceScope: "production-code-only",
    description: "Derived only from indexed production Java/Kotlin source. Curated feature descriptions and README text are not evidence for this inventory. Explicit integration surfaces are separated from ordinary third-party dependency imports.",
    modules: Object.freeze(modules.map((module) => moduleInventory(
      module,
      byModule.get(module.id) ?? [],
      modulePackageRoots
    )))
  });
}

export { SURFACE_LABELS, isProductionCode };