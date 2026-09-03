class GraphData {
  const GraphData({
    required this.generatedAt,
    required this.snapshotDate,
    required this.modules,
    required this.externalNodes,
    required this.features,
    required this.contracts,
    required this.sharedCapabilities,
    required this.codeInventory,
  });

  final String generatedAt;
  final String snapshotDate;
  final List<GraphModule> modules;
  final List<GraphExternalNode> externalNodes;
  final List<GraphFeature> features;
  final List<GraphContract> contracts;
  final List<GraphSharedCapability> sharedCapabilities;
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
