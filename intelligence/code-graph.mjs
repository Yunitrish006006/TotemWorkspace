import path from "node:path";
import { loadCodeIndex } from "./code-index.mjs";
import { buildCodeInventory } from "./code-inventory.mjs";
import { loadKnowledge } from "./workspace-knowledge.mjs";

const FILE_LIMIT_PER_MODULE = 42;
const SYMBOL_LIMIT_PER_FILE = 6;

const CATEGORY_LABELS = Object.freeze({
  api: "API / Contract",
  networking: "Networking",
  persistence: "Persistence",
  registry: "Registry / Bootstrap",
  client: "Client",
  test: "Tests / GameTests",
  config: "Config / Metadata",
  source: "Implementation"
});

function normalize(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function classifyFile(filePath) {
  const value = normalize(filePath).toLowerCase();
  const base = path.posix.basename(value);
  if (value.includes("/gametest/") || value.includes("/test/") || /(?:test|gametest)\.(?:java|kt|js|mjs)$/.test(base)) return "test";
  if (value.includes("/client/") || /(?:screen|renderer|client|hud)\.(?:java|kt)$/.test(base)) return "client";
  if (value.includes("/api/") || /(?:api|contract|interface|lifecycle|policy)\.(?:java|kt)$/.test(base)) return "api";
  if (/(?:saveddata|persistent|persistence|storage|store|state)\.(?:java|kt)$/.test(base)) return "persistence";
  if (/(?:payload|packet|network|networking|channel)\.(?:java|kt)$/.test(base)) return "networking";
  if (/(?:registry|registration|bootstrap|initializer)\.(?:java|kt)$/.test(base)) return "registry";
  if (["fabric.mod.json", "gradle.properties", "build.gradle", "settings.gradle"].includes(base) || value.endsWith(".toml") || value.endsWith(".properties")) return "config";
  return "source";
}

function uniqueSymbols(chunks) {
  const names = [];
  const seen = new Set();
  for (const chunk of chunks) {
    for (const symbol of chunk.symbols ?? []) {
      const name = String(symbol ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function filePriority(fileState, chunks, category) {
  const value = normalize(fileState.path).toLowerCase();
  let score = 0;
  if (value.startsWith("src/main/")) score += 70;
  if (value.startsWith("src/client/")) score += 65;
  if (value.includes("/gametest/") || value.includes("/test/")) score += 55;
  if (category !== "source") score += 24;
  score += Math.min(24, uniqueSymbols(chunks).length * 3);
  if (value.endsWith(".java") || value.endsWith(".kt")) score += 12;
  return score;
}

function stableNodeId(prefix, ...parts) {
  return [prefix, ...parts].join(":");
}

function moduleRankHint(moduleId) {
  if (moduleId === "totem-core") return 3;
  if (["totem-discord-bridge", "totem-nexus", "totem-remnant", "totem-vanilla-tweaks"].includes(moduleId)) return 2;
  return 1;
}

function externalName(contract, nodeId) {
  if (nodeId === "external:cloudflare") return "Cloudflare Worker / Discord";
  if (nodeId === "external:trinkets") return "Trinkets Updated";
  if (nodeId === "external:openai") return "OpenAI-compatible API";
  if (contract?.target && contract.to === nodeId) return String(contract.target);
  if (contract?.source && contract.from === nodeId) return String(contract.source);
  return nodeId.replace(/^external:/, "");
}

function graphTimestamp(knowledge, index) {
  return index?.generatedAt ?? knowledge.snapshot?.date ?? null;
}

function isProductionManualPath(filePath) {
  const value = normalize(filePath).toLowerCase();
  if (!(value.startsWith("src/main/") || value.startsWith("src/client/"))) return false;
  if (value.includes("/gametest/") || value.includes("/test/")) return false;
  const base = path.posix.basename(value);
  return value.includes("/manual/") || /manual.*\.(?:java|kt)$/.test(base) || /.*manual\.(?:java|kt)$/.test(base);
}

const CORE_API_CAPABILITY_FAMILIES = Object.freeze([
  Object.freeze({
    key: "client.world",
    label: "Core World Outline API",
    importPattern: /^(?:v\d+\.)?client\.world\./,
    providerFeaturePattern: /世界輪廓|world\s*outline|outline/i,
    consumerFeaturePattern: /輪廓|框線|連線|world\s*outline|outline|visualization|visual|line/i
  })
]);

function coreApiCapabilities(knowledge, codeInventory) {
  const coreInventory = codeInventory?.modules?.find((module) => module.moduleId === "totem-core");
  const corePackageRoot = coreInventory?.packageRoot;
  if (!corePackageRoot) return [];

  const apiPrefix = `${corePackageRoot}.api.`;
  const capabilities = [];
  for (const consumerInventory of codeInventory.modules ?? []) {
    if (consumerInventory.moduleId === "totem-core") continue;
    const crossImport = (consumerInventory.crossModuleImports ?? [])
      .find((entry) => entry.targetModuleId === "totem-core");
    if (!crossImport) continue;

    for (const family of CORE_API_CAPABILITY_FAMILIES) {
      const imports = (crossImport.imports ?? []).filter((importName) => {
        if (!importName.startsWith(apiPrefix)) return false;
        return family.importPattern.test(importName.slice(apiPrefix.length));
      });
      if (!imports.length) continue;

      const providerFeature = knowledge.features.find((feature) =>
        feature.ownerId === "totem-core"
        && family.providerFeaturePattern.test(`${feature.title} ${feature.summary}`));
      const consumerFeatures = knowledge.features.filter((feature) =>
        feature.ownerId === consumerInventory.moduleId
        && family.consumerFeaturePattern.test(`${feature.title} ${feature.summary}`));
      const endpoints = consumerFeatures.length ? consumerFeatures : [null];
      const consumerModule = knowledge.moduleById.get(consumerInventory.moduleId);

      endpoints.forEach((consumerFeature, index) => {
        capabilities.push(Object.freeze({
          id: `shared:core-api:${family.key}:${consumerInventory.moduleId}:${consumerFeature?.id ?? index + 1}`,
          type: "shared-capability",
          family: `core-api:${family.key}`,
          providerModuleId: "totem-core",
          consumerModuleId: consumerInventory.moduleId,
          providerFeatureId: providerFeature?.id ?? null,
          consumerFeatureId: consumerFeature?.id ?? null,
          providerLabel: providerFeature?.title ?? family.label,
          consumerLabel: consumerFeature?.title ?? `${consumerModule?.name ?? consumerInventory.moduleId} ${family.key} consumer`,
          label: family.label,
          evidencePaths: Object.freeze([...(crossImport.evidencePaths ?? [])].sort().slice(0, 8)),
          imports: Object.freeze([...imports].sort())
        }));
      });
    }
  }
  return capabilities;
}

function sharedCapabilities(knowledge, index, codeInventory) {
  if (!index?.fileStates?.length) return Object.freeze([]);
  const provider = knowledge.moduleById.get("totem-core");
  if (!provider) return Object.freeze([]);
  const providerFeature = knowledge.features.find((feature) => feature.ownerId === "totem-core" && /manual|手冊/i.test(`${feature.title} ${feature.summary}`));
  const capabilities = [];
  for (const module of knowledge.modules) {
    if (module.id === "totem-core") continue;
    const evidencePaths = index.fileStates
      .filter((file) => file.moduleId === module.id && isProductionManualPath(file.path))
      .map((file) => normalize(file.path))
      .sort();
    if (!evidencePaths.length) continue;
    capabilities.push(Object.freeze({
      id: `shared:manual:${module.id}`,
      type: "shared-capability",
      family: "manual",
      providerModuleId: "totem-core",
      consumerModuleId: module.id,
      providerFeatureId: providerFeature?.id ?? null,
      consumerFeatureId: null,
      providerLabel: "Manual Registry / Renderer",
      consumerLabel: `${module.name} shared manual chapter`,
      label: "Shared Totem Manual",
      evidencePaths: Object.freeze(evidencePaths.slice(0, 6)),
      imports: Object.freeze([])
    }));
  }
  capabilities.push(...coreApiCapabilities(knowledge, codeInventory));
  return Object.freeze(capabilities);
}

export function buildCodeDetailGraph({ knowledge = loadKnowledge(), index = loadCodeIndex({ knowledge }) } = {}) {
  const nodes = [];
  const edges = [];
  const moduleStats = [];
  if (!index?.fileStates || !index?.chunks) {
    return Object.freeze({
      schemaVersion: 1,
      generatedAt: graphTimestamp(knowledge, index),
      sourceIndexGeneratedAt: index?.generatedAt ?? null,
      indexed: false,
      nodes: Object.freeze([]),
      edges: Object.freeze([]),
      moduleStats: Object.freeze([])
    });
  }

  const chunksByFile = new Map();
  for (const chunk of index.chunks) {
    const key = `${chunk.moduleId}\0${chunk.path}`;
    if (!chunksByFile.has(key)) chunksByFile.set(key, []);
    chunksByFile.get(key).push(chunk);
  }

  for (const module of knowledge.modules) {
    const moduleFileStates = index.fileStates.filter((file) => file.moduleId === module.id);
    const moduleFiles = moduleFileStates
      .map((file) => {
        const chunks = chunksByFile.get(`${module.id}\0${file.path}`) ?? [];
        const symbols = uniqueSymbols(chunks);
        const category = classifyFile(file.path);
        return { file, chunks, symbols, category, priority: filePriority(file, chunks, category) };
      })
      .filter((entry) => entry.symbols.length > 0 || entry.category !== "source")
      .sort((a, b) => b.priority - a.priority || (b.file.mtimeMs ?? 0) - (a.file.mtimeMs ?? 0) || a.file.path.localeCompare(b.file.path))
      .slice(0, FILE_LIMIT_PER_MODULE);

    const categories = new Map();
    for (const entry of moduleFiles) {
      if (!categories.has(entry.category)) categories.set(entry.category, []);
      categories.get(entry.category).push(entry);
    }

    for (const [category, files] of categories) {
      const categoryId = stableNodeId("code-category", module.id, category);
      nodes.push(Object.freeze({
        id: categoryId,
        type: "code-category",
        moduleId: module.id,
        category,
        label: CATEGORY_LABELS[category] ?? category,
        count: files.length
      }));
      edges.push(Object.freeze({
        id: stableNodeId("contains", module.id, category),
        type: "contains-category",
        from: module.id,
        to: categoryId
      }));

      for (const entry of files) {
        const fileId = stableNodeId("code-file", module.id, entry.file.path);
        nodes.push(Object.freeze({
          id: fileId,
          type: entry.category === "test" ? "test-file" : "code-file",
          moduleId: module.id,
          category: entry.category,
          label: path.posix.basename(entry.file.path),
          path: entry.file.path,
          mtimeMs: entry.file.mtimeMs ?? null,
          symbolCount: entry.symbols.length
        }));
        edges.push(Object.freeze({
          id: stableNodeId("contains-file", module.id, entry.category, entry.file.path),
          type: "contains-file",
          from: categoryId,
          to: fileId
        }));

        for (const symbol of entry.symbols.slice(0, SYMBOL_LIMIT_PER_FILE)) {
          const symbolId = stableNodeId("code-symbol", module.id, entry.file.path, symbol);
          nodes.push(Object.freeze({
            id: symbolId,
            type: "code-symbol",
            moduleId: module.id,
            category: entry.category,
            label: symbol,
            path: entry.file.path
          }));
          edges.push(Object.freeze({
            id: stableNodeId("declares", module.id, entry.file.path, symbol),
            type: "declares",
            from: fileId,
            to: symbolId
          }));
        }
      }
    }

    moduleStats.push(Object.freeze({
      moduleId: module.id,
      indexedFiles: moduleFileStates.length,
      visualizedFiles: moduleFiles.length,
      visualizedSymbols: moduleFiles.reduce((sum, entry) => sum + Math.min(SYMBOL_LIMIT_PER_FILE, entry.symbols.length), 0),
      categories: Object.freeze([...categories.keys()])
    }));
  }

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: graphTimestamp(knowledge, index),
    sourceIndexGeneratedAt: index.generatedAt ?? null,
    indexed: true,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    moduleStats: Object.freeze(moduleStats)
  });
}

export function buildGraphViewModel({ knowledge = loadKnowledge(), index = loadCodeIndex({ knowledge }) } = {}) {
  const code = buildCodeDetailGraph({ knowledge, index });
  const codeInventory = buildCodeInventory({ knowledge, index });
  const externalIds = new Set();
  for (const contract of knowledge.contracts) {
    for (const node of [contract.from, contract.to, ...(contract.relatedNodes ?? [])]) {
      if (node && !knowledge.moduleById.has(node)) externalIds.add(node);
    }
  }

  const externalNodes = [...externalIds].map((id) => {
    const contract = knowledge.contracts.find((entry) => entry.from === id || entry.to === id || entry.relatedNodes?.includes(id));
    return Object.freeze({ id, name: externalName(contract, id), rankHint: 4 });
  });

  return Object.freeze({
    schemaVersion: 3,
    generatedAt: graphTimestamp(knowledge, index),
    snapshot: knowledge.snapshot,
    modules: Object.freeze(knowledge.modules.map((module) => Object.freeze({
      id: module.id,
      name: module.name,
      version: module.version,
      role: module.role,
      repoName: module.repoName,
      rankHint: moduleRankHint(module.id),
      featureGroups: Object.freeze([...(module.featureGroups ?? [])])
    }))),
    externalNodes: Object.freeze(externalNodes),
    features: Object.freeze(knowledge.features.map((feature) => Object.freeze({
      id: feature.id,
      ownerId: feature.ownerId,
      title: feature.title,
      summary: feature.summary,
      softContractIds: feature.softContractIds,
      serviceContractIds: feature.serviceContractIds,
      eventContractIds: feature.eventContractIds
    }))),
    contracts: Object.freeze(knowledge.contracts.map((contract) => Object.freeze({
      id: contract.id,
      type: contract.type,
      from: contract.from,
      to: contract.to,
      relatedNodes: contract.relatedNodes ?? [],
      feature: contract.feature ?? null,
      fallback: contract.fallback ?? null,
      family: contract.family ?? null,
      protocol: contract.protocol ?? null,
      featureIds: contract.featureIds ?? []
    }))),
    sharedCapabilities: sharedCapabilities(knowledge, index, codeInventory),
    code,
    codeInventory
  });
}
