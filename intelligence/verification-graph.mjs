import path from "node:path";
import { tokenize } from "./workspace-knowledge.mjs";

const TEST_EXTENSIONS = /\.(?:java|kt|kts|js|mjs)$/i;
const TEST_FILE_NAME = /(?:test|tests|gametest|gametests|e2e|integration|spec|it)\.(?:java|kt|kts|js|mjs)$/i;
const STOP_TOKENS = new Set([
  "test", "tests", "gametest", "gametests", "e2e", "integration", "spec", "src",
  "main", "java", "kotlin", "client", "server", "totem", "module", "feature"
]);

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

export function isTestPath(filePath) {
  const value = normalizePath(filePath).toLowerCase();
  const base = path.posix.basename(value);
  if (!TEST_EXTENSIONS.test(base)) return false;
  return value.startsWith("src/test/")
    || value.startsWith("src/e2e/")
    || value.startsWith("src/gametest/")
    || value.includes("/src/test/")
    || value.includes("/src/e2e/")
    || value.includes("/gametest/")
    || value.includes("/test/")
    || TEST_FILE_NAME.test(base);
}

function testKind(filePath, text) {
  const value = normalizePath(filePath).toLowerCase();
  const body = normalizeText(text);
  if (value.includes("/e2e/") || /(?:^|[^a-z])e2e(?:[^a-z]|$)/.test(value)) return "e2e";
  if (value.includes("gametest") || body.includes("@gametest") || body.includes("gametesthelper")) {
    return value.includes("client") || body.includes("clientgametest") ? "client-gametest" : "gametest";
  }
  if (value.includes("integration") || /(?:integration|integrationtest|it)\.(?:java|kt|js|mjs)$/.test(path.posix.basename(value))) {
    return "integration";
  }
  if (value.includes("/client/") || value.includes("clienttest")) return "client-test";
  return "unit-test";
}

function chunksByFile(index) {
  const byFile = new Map();
  for (const chunk of index?.chunks ?? []) {
    const key = `${chunk.moduleId}\0${normalizePath(chunk.path)}`;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(chunk);
  }
  return byFile;
}

function testCorpus(file, chunks) {
  const symbols = unique(chunks.flatMap((chunk) => chunk.symbols ?? []));
  const body = chunks.map((chunk) => chunk.text ?? "").join("\n").slice(0, 50000);
  return {
    text: normalizeText(`${file.path}\n${symbols.join(" ")}\n${body}`),
    symbols,
    tokens: new Set(
      tokenize(`${file.path} ${symbols.join(" ")} ${body}`)
        .map(normalizeText)
        .filter((token) => token.length > 2 && !STOP_TOKENS.has(token))
    )
  };
}

function semanticTokens(...values) {
  return unique(
    tokenize(values.filter(Boolean).join(" "))
      .map(normalizeText)
      .filter((token) => token.length > 2 && !STOP_TOKENS.has(token))
  );
}

function tokenScore(tokens, corpus) {
  let score = 0;
  for (const token of tokens) {
    if (corpus.tokens.has(token)) score += token.length >= 7 ? 3 : 2;
    else if (token.length >= 5 && corpus.text.includes(token)) score += 1;
  }
  return score;
}

function featureScore(feature, corpus) {
  const tokens = semanticTokens(feature.title, feature.summary);
  let score = tokenScore(tokens, corpus);
  const title = normalizeText(feature.title).trim();
  if (title.length >= 4 && corpus.text.includes(title)) score += 8;
  return score;
}

function componentScore(component, corpus) {
  let score = tokenScore(
    semanticTokens(component.key, component.label, component.responsibility, ...(component.symbols ?? [])),
    corpus
  );
  const label = normalizeText(component.label).trim();
  if (label.length >= 4 && corpus.text.includes(label)) score += 7;

  for (const symbol of component.symbols ?? []) {
    const value = normalizeText(symbol);
    if (value.length >= 4 && corpus.text.includes(value)) score += 4;
  }

  for (const implementationPath of component.implementationPaths ?? []) {
    const stem = path.posix.basename(normalizePath(implementationPath)).replace(/\.[^.]+$/, "").toLowerCase();
    if (stem.length >= 4 && corpus.text.includes(stem)) score += 7;
  }
  return score;
}

function topMatches(entries, minimumScore, max = 3) {
  if (!entries.length) return [];
  const sorted = [...entries].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const best = sorted[0]?.score ?? 0;
  return sorted
    .filter((entry) => entry.score >= minimumScore && entry.score >= best - 3)
    .slice(0, max);
}

function testCategories(kind) {
  if (kind === "gametest") return ["gametest", "existing-unit-or-gametest"];
  if (kind === "client-gametest") return ["client-gametest", "gametest", "existing-unit-or-gametest"];
  if (kind === "e2e") return ["three-jvm-e2e"];
  if (kind === "integration") return ["existing-unit-or-gametest"];
  if (kind === "client-test") return ["client-runtime-check", "existing-unit-or-gametest"];
  return ["unit-tests", "existing-unit-or-gametest"];
}

function buildRequirements(knowledge) {
  const defaults = knowledge.testMatrix?.defaults?.validation ?? [];
  const result = [];
  for (const module of knowledge.modules ?? []) {
    const modulePlan = knowledge.testMatrix?.modules?.[module.id] ?? {};
    const byCategory = new Map();
    for (const category of defaults) {
      byCategory.set(category, { category, sources: ["default"] });
    }
    for (const category of modulePlan.validation ?? []) {
      const existing = byCategory.get(category) ?? { category, sources: [] };
      existing.sources = unique([...existing.sources, "module"]);
      byCategory.set(category, existing);
    }
    for (const entry of [...byCategory.values()].sort((a, b) => a.category.localeCompare(b.category))) {
      result.push(Object.freeze({
        id: `verification-requirement:${module.id}:${entry.category}`,
        moduleId: module.id,
        category: entry.category,
        sources: Object.freeze(entry.sources),
        notes: modulePlan.notes ?? null
      }));
    }
  }
  return Object.freeze(result);
}

function validatedByRelation(targetId, testId, targetType, confidence) {
  return Object.freeze({
    id: `validated-by:${targetId}:${testId}`,
    type: "validated-by",
    from: targetId,
    to: testId,
    targetType,
    confidence
  });
}

export function buildVerificationGraph({
  knowledge,
  index,
  components = [],
  sharedCapabilities = []
} = {}) {
  const byFile = chunksByFile(index);
  const tests = [];
  const relations = [];
  const moduleFeatures = new Map();
  const moduleComponents = new Map();

  for (const feature of knowledge?.features ?? []) {
    if (!moduleFeatures.has(feature.ownerId)) moduleFeatures.set(feature.ownerId, []);
    moduleFeatures.get(feature.ownerId).push(feature);
  }
  for (const component of components ?? []) {
    if (!moduleComponents.has(component.moduleId)) moduleComponents.set(component.moduleId, []);
    moduleComponents.get(component.moduleId).push(component);
  }

  for (const file of index?.fileStates ?? []) {
    const testPath = normalizePath(file.path);
    if (!isTestPath(testPath)) continue;
    const chunks = byFile.get(`${file.moduleId}\0${testPath}`) ?? [];
    const corpus = testCorpus(file, chunks);
    const kind = testKind(testPath, corpus.text);

    const componentMatches = topMatches(
      (moduleComponents.get(file.moduleId) ?? []).map((component) => ({
        id: component.id,
        score: componentScore(component, corpus),
        component
      })),
      6
    );

    const directFeatureMatches = topMatches(
      (moduleFeatures.get(file.moduleId) ?? []).map((feature) => ({
        id: feature.id,
        score: featureScore(feature, corpus),
        feature
      })),
      5
    );

    const componentFeatureIds = componentMatches.flatMap((entry) => entry.component.featureIds ?? []);
    const featureIds = unique([
      ...componentFeatureIds,
      ...directFeatureMatches.map((entry) => entry.id)
    ]).sort();

    const contractIds = unique(
      (knowledge?.contracts ?? [])
        .filter((contract) => (contract.featureIds ?? []).some((id) => featureIds.includes(id)))
        .map((contract) => contract.id)
    ).sort();

    const capabilityIds = unique(
      (sharedCapabilities ?? [])
        .filter((capability) => [capability.providerFeatureId, capability.consumerFeatureId]
          .filter(Boolean)
          .some((id) => featureIds.includes(id)))
        .map((capability) => capability.id)
    ).sort();

    const id = `test:${file.moduleId}:${testPath}`;
    const test = Object.freeze({
      id,
      type: "test",
      moduleId: file.moduleId,
      repoName: file.repoName,
      path: testPath,
      label: path.posix.basename(testPath),
      kind,
      categories: Object.freeze(testCategories(kind)),
      symbols: Object.freeze(corpus.symbols.slice(0, 16)),
      featureIds: Object.freeze(featureIds),
      componentIds: Object.freeze(componentMatches.map((entry) => entry.id).sort()),
      contractIds: Object.freeze(contractIds),
      capabilityIds: Object.freeze(capabilityIds)
    });
    tests.push(test);

    for (const featureId of test.featureIds) {
      relations.push(validatedByRelation(featureId, id, "feature", "semantic"));
    }
    for (const contractId of test.contractIds) {
      relations.push(validatedByRelation(contractId, id, "contract", "feature-bound"));
    }
    for (const capabilityId of test.capabilityIds) {
      relations.push(validatedByRelation(capabilityId, id, "capability", "feature-bound"));
    }
  }

  tests.sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.path.localeCompare(b.path));
  relations.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const coverage = Object.freeze((knowledge?.modules ?? []).map((module) => {
    const moduleTests = tests.filter((test) => test.moduleId === module.id);
    const featureIds = unique(moduleTests.flatMap((test) => test.featureIds)).sort();
    return Object.freeze({
      moduleId: module.id,
      testCount: moduleTests.length,
      linkedFeatureCount: featureIds.length,
      linkedFeatureIds: Object.freeze(featureIds)
    });
  }));

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: index?.generatedAt ?? knowledge?.snapshot?.date ?? null,
    tests: Object.freeze(tests),
    relations: Object.freeze(relations),
    requirements: buildRequirements(knowledge),
    coverage
  });
}

export function activeVerificationPlan({ knowledge, changeIntelligence } = {}) {
  const modules = unique([
    ...(changeIntelligence?.impact?.touchedModules ?? []),
    ...(changeIntelligence?.impact?.impactedModules ?? [])
  ]).filter((id) => knowledge?.moduleById?.has(id));

  const categories = new Set(knowledge?.testMatrix?.defaults?.validation ?? []);
  for (const moduleId of modules) {
    for (const category of knowledge?.testMatrix?.modules?.[moduleId]?.validation ?? []) {
      categories.add(category);
    }
  }

  const activeRisks = new Set(changeIntelligence?.impact?.risks ?? []);
  for (const rule of knowledge?.testMatrix?.riskRules ?? []) {
    if (!(rule.tags ?? []).some((tag) => activeRisks.has(tag))) continue;
    for (const category of rule.validation ?? []) categories.add(category);
  }

  return Object.freeze({
    modules: Object.freeze(modules.sort()),
    risks: Object.freeze([...activeRisks].sort()),
    requiredCategories: Object.freeze([...categories].sort()),
    requirementIds: Object.freeze(
      modules.flatMap((moduleId) => [...categories].map((category) =>
        `verification-requirement:${moduleId}:${category}`
      )).sort()
    )
  });
}
