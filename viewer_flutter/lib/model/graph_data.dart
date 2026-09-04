class GraphData {
  const GraphData({
    required this.generatedAt,
    required this.snapshotDate,
    required this.modules,
    required this.externalNodes,
    required this.features,
    required this.contracts,
    required this.sharedCapabilities,
    required this.components,
    required this.verification,
    required this.codeInventory,
  });

  final String generatedAt;
  final String snapshotDate;
  final List<GraphModule> modules;
  final List<GraphExternalNode> externalNodes;
  final List<GraphFeature> features;
  final List<GraphContract> contracts;
  final List<GraphSharedCapability> sharedCapabilities;
  final List<GraphComponent> components;
  final GraphVerification verification;
  final GraphCodeInventory codeInventory;

  factory GraphData.fromJson(Map<String, dynamic> json) {
    final snapshot = json['snapshot'] as Map<String, dynamic>? ?? const {};
    return GraphData(
      generatedAt: json['generatedAt'] as String? ?? 'unknown',
      snapshotDate: snapshot['date'] as String? ?? 'unknown',
      modules: _objects(json['modules']).map(GraphModule.fromJson).toList(growable: false),
      externalNodes: _objects(json['externalNodes']).map(GraphExternalNode.fromJson).toList(growable: false),
      features: _objects(json['features']).map(GraphFeature.fromJson).toList(growable: false),
      contracts: _objects(json['contracts']).map(GraphContract.fromJson).toList(growable: false),
      sharedCapabilities:
          _objects(json['sharedCapabilities']).map(GraphSharedCapability.fromJson).toList(growable: false),
      components: _objects(json['components']).map(GraphComponent.fromJson).toList(growable: false),
      verification: GraphVerification.fromJson(
        json['verification'] is Map ? Map<String, dynamic>.from(json['verification'] as Map) : const {},
      ),
      codeInventory: GraphCodeInventory.fromJson(
        json['codeInventory'] is Map ? Map<String, dynamic>.from(json['codeInventory'] as Map) : const {},
      ),
    );
  }

  GraphModule? moduleById(String id) {
    for (final module in modules) {
      if (module.id == id) return module;
    }
    return null;
  }

  GraphModuleInventory? inventoryForModule(String id) => codeInventory.moduleById(id);

  GraphFeature? featureById(String id) {
    for (final feature in features) {
      if (feature.id == id) return feature;
    }
    return null;
  }

  GraphComponent? componentById(String id) {
    for (final component in components) {
      if (component.id == id) return component;
    }
    return null;
  }

  List<GraphComponent> componentsForFeature(String featureId) =>
      components.where((component) => component.featureIds.contains(featureId)).toList(growable: false);

  List<GraphComponent> componentsForModule(String moduleId) =>
      components.where((component) => component.moduleId == moduleId).toList(growable: false);

  GraphTest? testById(String id) => verification.testById(id);

  List<GraphTest> testsForFeature(String featureId) => verification.tests
      .where((test) => test.featureIds.contains(featureId))
      .toList(growable: false);

  List<GraphTest> testsForModule(String moduleId) => verification.tests
      .where((test) => test.moduleId == moduleId)
      .toList(growable: false);

  GraphFeature? manualFeatureFor(String moduleId) {
    final matcher = RegExp(r'manual|手冊', caseSensitive: false);
    for (final feature in features) {
      if (feature.ownerId == moduleId && matcher.hasMatch('${feature.title} ${feature.summary}')) {
        return feature;
      }
    }
    return null;
  }

  static Iterable<Map<String, dynamic>> _objects(Object? value) {
    if (value is! List) return const <Map<String, dynamic>>[];
    return value.whereType<Map>().map((entry) => Map<String, dynamic>.from(entry));
  }

  static List<String> strings(Object? value) =>
      (value as List? ?? const []).whereType<String>().toList(growable: false);
}

class GraphModule {
  const GraphModule({
    required this.id,
    required this.name,
    required this.version,
    required this.role,
    required this.rankHint,
    required this.featureGroups,
  });

  final String id;
  final String name;
  final String version;
  final String role;
  final int rankHint;
  final List<String> featureGroups;

  factory GraphModule.fromJson(Map<String, dynamic> json) => GraphModule(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        version: json['version'] as String? ?? '',
        role: json['role'] as String? ?? '',
        rankHint: (json['rankHint'] as num?)?.toInt() ?? 4,
        featureGroups: GraphData.strings(json['featureGroups']),
      );
}

class GraphExternalNode {
  const GraphExternalNode({required this.id, required this.name, required this.rankHint});

  final String id;
  final String name;
  final int rankHint;

  factory GraphExternalNode.fromJson(Map<String, dynamic> json) => GraphExternalNode(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        rankHint: (json['rankHint'] as num?)?.toInt() ?? 4,
      );
}

class GraphFeature {
  const GraphFeature({
    required this.id,
    required this.ownerId,
    required this.title,
    required this.summary,
    required this.softContractIds,
    required this.serviceContractIds,
    required this.eventContractIds,
  });

  final String id;
  final String ownerId;
  final String title;
  final String summary;
  final List<String> softContractIds;
  final List<String> serviceContractIds;
  final List<String> eventContractIds;

  List<String> get contractIds => {
        ...softContractIds,
        ...serviceContractIds,
        ...eventContractIds,
      }.toList(growable: false);

  bool get hasCrossModuleRelations => contractIds.isNotEmpty;

  factory GraphFeature.fromJson(Map<String, dynamic> json) => GraphFeature(
        id: json['id'] as String? ?? '',
        ownerId: json['ownerId'] as String? ?? '',
        title: json['title'] as String? ?? '',
        summary: json['summary'] as String? ?? '',
        softContractIds: GraphData.strings(json['softContractIds']),
        serviceContractIds: GraphData.strings(json['serviceContractIds']),
        eventContractIds: GraphData.strings(json['eventContractIds']),
      );
}

class GraphContract {
  const GraphContract({
    required this.id,
    required this.type,
    required this.from,
    required this.to,
    required this.feature,
    required this.relatedNodes,
    required this.featureIds,
  });

  final String id;
  final String type;
  final String from;
  final String to;
  final String feature;
  final List<String> relatedNodes;
  final List<String> featureIds;

  factory GraphContract.fromJson(Map<String, dynamic> json) => GraphContract(
        id: json['id'] as String? ?? '',
        type: json['type'] as String? ?? 'unknown',
        from: json['from'] as String? ?? '',
        to: json['to'] as String? ?? '',
        feature: json['feature'] as String? ?? '',
        relatedNodes: GraphData.strings(json['relatedNodes']),
        featureIds: GraphData.strings(json['featureIds']),
      );
}

class GraphSharedCapability {
  const GraphSharedCapability({
    required this.id,
    required this.type,
    required this.family,
    required this.providerModuleId,
    required this.consumerModuleId,
    required this.providerFeatureId,
    required this.consumerFeatureId,
    required this.providerLabel,
    required this.consumerLabel,
    required this.label,
    required this.evidencePaths,
  });

  final String id;
  final String type;
  final String family;
  final String providerModuleId;
  final String consumerModuleId;
  final String? providerFeatureId;
  final String? consumerFeatureId;
  final String providerLabel;
  final String consumerLabel;
  final String label;
  final List<String> evidencePaths;

  factory GraphSharedCapability.fromJson(Map<String, dynamic> json) => GraphSharedCapability(
        id: json['id'] as String? ?? '',
        type: json['type'] as String? ?? 'shared-capability',
        family: json['family'] as String? ?? '',
        providerModuleId: json['providerModuleId'] as String? ?? '',
        consumerModuleId: json['consumerModuleId'] as String? ?? '',
        providerFeatureId: json['providerFeatureId'] as String?,
        consumerFeatureId: json['consumerFeatureId'] as String?,
        providerLabel: json['providerLabel'] as String? ?? '',
        consumerLabel: json['consumerLabel'] as String? ?? '',
        label: json['label'] as String? ?? 'Shared capability',
        evidencePaths: GraphData.strings(json['evidencePaths']),
      );
}

class GraphComponent {
  const GraphComponent({
    required this.id,
    required this.moduleId,
    required this.key,
    required this.label,
    required this.responsibility,
    required this.featureIds,
    required this.mappingScore,
    required this.mappingConfidence,
    required this.fileCount,
    required this.implementationPaths,
    required this.representativePaths,
    required this.symbols,
    required this.surfaceKinds,
  });

  final String id;
  final String moduleId;
  final String key;
  final String label;
  final String responsibility;
  final List<String> featureIds;
  final int mappingScore;
  final String mappingConfidence;
  final int fileCount;
  final List<String> implementationPaths;
  final List<String> representativePaths;
  final List<String> symbols;
  final List<String> surfaceKinds;

  bool get isMapped => featureIds.isNotEmpty;

  factory GraphComponent.fromJson(Map<String, dynamic> json) => GraphComponent(
        id: json['id'] as String? ?? '',
        moduleId: json['moduleId'] as String? ?? '',
        key: json['key'] as String? ?? '',
        label: json['label'] as String? ?? '',
        responsibility: json['responsibility'] as String? ?? '',
        featureIds: GraphData.strings(json['featureIds']),
        mappingScore: (json['mappingScore'] as num?)?.toInt() ?? 0,
        mappingConfidence: json['mappingConfidence'] as String? ?? 'unmapped',
        fileCount: (json['fileCount'] as num?)?.toInt() ?? 0,
        implementationPaths: GraphData.strings(json['implementationPaths']),
        representativePaths: GraphData.strings(json['representativePaths']),
        symbols: GraphData.strings(json['symbols']),
        surfaceKinds: GraphData.strings(json['surfaceKinds']),
      );
}

class GraphVerification {
  const GraphVerification({
    required this.schemaVersion,
    required this.generatedAt,
    required this.tests,
    required this.relations,
    required this.requirements,
    required this.coverage,
  });

  final int schemaVersion;
  final String generatedAt;
  final List<GraphTest> tests;
  final List<GraphVerificationRelation> relations;
  final List<GraphVerificationRequirement> requirements;
  final List<GraphVerificationCoverage> coverage;

  factory GraphVerification.fromJson(Map<String, dynamic> json) => GraphVerification(
        schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 1,
        generatedAt: json['generatedAt'] as String? ?? '',
        tests: GraphData._objects(json['tests']).map(GraphTest.fromJson).toList(growable: false),
        relations:
            GraphData._objects(json['relations']).map(GraphVerificationRelation.fromJson).toList(growable: false),
        requirements:
            GraphData._objects(json['requirements']).map(GraphVerificationRequirement.fromJson).toList(growable: false),
        coverage:
            GraphData._objects(json['coverage']).map(GraphVerificationCoverage.fromJson).toList(growable: false),
      );

  GraphTest? testById(String id) {
    for (final test in tests) {
      if (test.id == id) return test;
    }
    return null;
  }
}

class GraphTest {
  const GraphTest({
    required this.id,
    required this.moduleId,
    required this.repoName,
    required this.path,
    required this.label,
    required this.kind,
    required this.categories,
    required this.symbols,
    required this.featureIds,
    required this.componentIds,
    required this.contractIds,
    required this.capabilityIds,
  });

  final String id;
  final String moduleId;
  final String repoName;
  final String path;
  final String label;
  final String kind;
  final List<String> categories;
  final List<String> symbols;
  final List<String> featureIds;
  final List<String> componentIds;
  final List<String> contractIds;
  final List<String> capabilityIds;

  factory GraphTest.fromJson(Map<String, dynamic> json) => GraphTest(
        id: json['id'] as String? ?? '',
        moduleId: json['moduleId'] as String? ?? '',
        repoName: json['repoName'] as String? ?? '',
        path: json['path'] as String? ?? '',
        label: json['label'] as String? ?? '',
        kind: json['kind'] as String? ?? 'test',
        categories: GraphData.strings(json['categories']),
        symbols: GraphData.strings(json['symbols']),
        featureIds: GraphData.strings(json['featureIds']),
        componentIds: GraphData.strings(json['componentIds']),
        contractIds: GraphData.strings(json['contractIds']),
        capabilityIds: GraphData.strings(json['capabilityIds']),
      );
}

class GraphVerificationRelation {
  const GraphVerificationRelation({
    required this.id,
    required this.type,
    required this.from,
    required this.to,
    required this.targetType,
    required this.confidence,
  });

  final String id;
  final String type;
  final String from;
  final String to;
  final String targetType;
  final String confidence;

  factory GraphVerificationRelation.fromJson(Map<String, dynamic> json) => GraphVerificationRelation(
        id: json['id'] as String? ?? '',
        type: json['type'] as String? ?? 'validated-by',
        from: json['from'] as String? ?? '',
        to: json['to'] as String? ?? '',
        targetType: json['targetType'] as String? ?? '',
        confidence: json['confidence'] as String? ?? '',
      );
}

class GraphVerificationRequirement {
  const GraphVerificationRequirement({
    required this.id,
    required this.moduleId,
    required this.category,
    required this.sources,
    required this.notes,
  });

  final String id;
  final String moduleId;
  final String category;
  final List<String> sources;
  final String? notes;

  factory GraphVerificationRequirement.fromJson(Map<String, dynamic> json) => GraphVerificationRequirement(
        id: json['id'] as String? ?? '',
        moduleId: json['moduleId'] as String? ?? '',
        category: json['category'] as String? ?? '',
        sources: GraphData.strings(json['sources']),
        notes: json['notes'] as String?,
      );
}

class GraphVerificationCoverage {
  const GraphVerificationCoverage({
    required this.moduleId,
    required this.testCount,
    required this.linkedFeatureCount,
    required this.linkedFeatureIds,
  });

  final String moduleId;
  final int testCount;
  final int linkedFeatureCount;
  final List<String> linkedFeatureIds;

  factory GraphVerificationCoverage.fromJson(Map<String, dynamic> json) => GraphVerificationCoverage(
        moduleId: json['moduleId'] as String? ?? '',
        testCount: (json['testCount'] as num?)?.toInt() ?? 0,
        linkedFeatureCount: (json['linkedFeatureCount'] as num?)?.toInt() ?? 0,
        linkedFeatureIds: GraphData.strings(json['linkedFeatureIds']),
      );
}

class GraphCodeInventory {
  const GraphCodeInventory({required this.sourceScope, required this.modules});

  final String sourceScope;
  final List<GraphModuleInventory> modules;

  factory GraphCodeInventory.fromJson(Map<String, dynamic> json) => GraphCodeInventory(
        sourceScope: json['sourceScope'] as String? ?? 'production-code-only',
        modules: GraphData._objects(json['modules']).map(GraphModuleInventory.fromJson).toList(growable: false),
      );

  GraphModuleInventory? moduleById(String id) {
    for (final module in modules) {
      if (module.moduleId == id) return module;
    }
    return null;
  }
}

class GraphModuleInventory {
  const GraphModuleInventory({
    required this.moduleId,
    required this.repoName,
    required this.packageRoot,
    required this.productionFileCount,
    required this.resourceEvidence,
    required this.featureAreas,
    required this.components,
    required this.surfaces,
    required this.integrations,
    required this.crossModuleImports,
  });

  final String moduleId;
  final String repoName;
  final String? packageRoot;
  final int productionFileCount;
  final GraphResourceEvidence resourceEvidence;
  final List<GraphFeatureArea> featureAreas;
  final List<GraphComponent> components;
  final Map<String, List<GraphCodeSurfaceItem>> surfaces;
  final List<GraphCodeIntegration> integrations;
  final List<GraphCrossModuleImport> crossModuleImports;

  factory GraphModuleInventory.fromJson(Map<String, dynamic> json) {
    final rawSurfaces = json['surfaces'] is Map ? Map<String, dynamic>.from(json['surfaces'] as Map) : const <String, dynamic>{};
    return GraphModuleInventory(
      moduleId: json['moduleId'] as String? ?? '',
      repoName: json['repoName'] as String? ?? '',
      packageRoot: json['packageRoot'] as String?,
      productionFileCount: (json['productionFileCount'] as num?)?.toInt() ?? 0,
      resourceEvidence: GraphResourceEvidence.fromJson(
        json['resourceEvidence'] is Map ? Map<String, dynamic>.from(json['resourceEvidence'] as Map) : const {},
      ),
      featureAreas: GraphData._objects(json['featureAreas']).map(GraphFeatureArea.fromJson).toList(growable: false),
      components: GraphData._objects(json['components']).map(GraphComponent.fromJson).toList(growable: false),
      surfaces: Map.unmodifiable({
        for (final entry in rawSurfaces.entries)
          entry.key: GraphData._objects(entry.value).map(GraphCodeSurfaceItem.fromJson).toList(growable: false),
      }),
      integrations: GraphData._objects(json['integrations']).map(GraphCodeIntegration.fromJson).toList(growable: false),
      crossModuleImports:
          GraphData._objects(json['crossModuleImports']).map(GraphCrossModuleImport.fromJson).toList(growable: false),
    );
  }

  List<GraphCodeSurfaceItem> surface(String key) => surfaces[key] ?? const <GraphCodeSurfaceItem>[];
}

class GraphResourceEvidence {
  const GraphResourceEvidence({
    required this.sourceScope,
    required this.fileCount,
    required this.families,
  });

  final String sourceScope;
  final int fileCount;
  final List<GraphResourceFamily> families;

  factory GraphResourceEvidence.fromJson(Map<String, dynamic> json) => GraphResourceEvidence(
        sourceScope: json['sourceScope'] as String? ?? 'production-resource-evidence',
        fileCount: (json['fileCount'] as num?)?.toInt() ?? 0,
        families: GraphData._objects(json['families']).map(GraphResourceFamily.fromJson).toList(growable: false),
      );
}

class GraphResourceFamily {
  const GraphResourceFamily({
    required this.key,
    required this.label,
    required this.fileCount,
    required this.representativePaths,
  });

  final String key;
  final String label;
  final int fileCount;
  final List<String> representativePaths;

  factory GraphResourceFamily.fromJson(Map<String, dynamic> json) => GraphResourceFamily(
        key: json['key'] as String? ?? '',
        label: json['label'] as String? ?? '',
        fileCount: (json['fileCount'] as num?)?.toInt() ?? 0,
        representativePaths: GraphData.strings(json['representativePaths']),
      );
}

class GraphFeatureArea {
  const GraphFeatureArea({
    required this.key,
    required this.label,
    required this.fileCount,
    required this.representativePaths,
    required this.symbols,
  });

  final String key;
  final String label;
  final int fileCount;
  final List<String> representativePaths;
  final List<String> symbols;

  factory GraphFeatureArea.fromJson(Map<String, dynamic> json) => GraphFeatureArea(
        key: json['key'] as String? ?? '',
        label: json['label'] as String? ?? '',
        fileCount: (json['fileCount'] as num?)?.toInt() ?? 0,
        representativePaths: GraphData.strings(json['representativePaths']),
        symbols: GraphData.strings(json['symbols']),
      );
}

class GraphCodeSurfaceItem {
  const GraphCodeSurfaceItem({required this.label, required this.path, required this.packageName, required this.symbols});

  final String label;
  final String path;
  final String? packageName;
  final List<String> symbols;

  factory GraphCodeSurfaceItem.fromJson(Map<String, dynamic> json) => GraphCodeSurfaceItem(
        label: json['label'] as String? ?? '',
        path: json['path'] as String? ?? '',
        packageName: json['package'] as String?,
        symbols: GraphData.strings(json['symbols']),
      );
}

class GraphCodeIntegration {
  const GraphCodeIntegration({required this.packageRoot, required this.imports, required this.evidencePaths});

  final String packageRoot;
  final List<String> imports;
  final List<String> evidencePaths;

  factory GraphCodeIntegration.fromJson(Map<String, dynamic> json) => GraphCodeIntegration(
        packageRoot: json['packageRoot'] as String? ?? '',
        imports: GraphData.strings(json['imports']),
        evidencePaths: GraphData.strings(json['evidencePaths']),
      );
}

class GraphCrossModuleImport {
  const GraphCrossModuleImport({required this.targetModuleId, required this.imports, required this.evidencePaths});

  final String targetModuleId;
  final List<String> imports;
  final List<String> evidencePaths;

  factory GraphCrossModuleImport.fromJson(Map<String, dynamic> json) => GraphCrossModuleImport(
        targetModuleId: json['targetModuleId'] as String? ?? '',
        imports: GraphData.strings(json['imports']),
        evidencePaths: GraphData.strings(json['evidencePaths']),
      );
}
