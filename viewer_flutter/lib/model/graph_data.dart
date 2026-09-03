class GraphData {
  const GraphData({
    required this.generatedAt,
    required this.snapshotDate,
    required this.modules,
    required this.externalNodes,
    required this.contracts,
  });

  final String generatedAt;
  final String snapshotDate;
  final List<GraphModule> modules;
  final List<GraphExternalNode> externalNodes;
  final List<GraphContract> contracts;

  factory GraphData.fromJson(Map<String, dynamic> json) {
    final snapshot = json['snapshot'] as Map<String, dynamic>? ?? const {};
    return GraphData(
      generatedAt: json['generatedAt'] as String? ?? 'unknown',
      snapshotDate: snapshot['date'] as String? ?? 'unknown',
      modules: _objects(json['modules']).map(GraphModule.fromJson).toList(growable: false),
      externalNodes: _objects(json['externalNodes']).map(GraphExternalNode.fromJson).toList(growable: false),
      contracts: _objects(json['contracts']).map(GraphContract.fromJson).toList(growable: false),
    );
  }

  static Iterable<Map<String, dynamic>> _objects(Object? value) {
    if (value is! List) return const <Map<String, dynamic>>[];
    return value.whereType<Map>().map((entry) => Map<String, dynamic>.from(entry));
  }
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
        featureGroups: (json['featureGroups'] as List? ?? const [])
            .whereType<String>()
            .toList(growable: false),
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

class GraphContract {
  const GraphContract({
    required this.id,
    required this.type,
    required this.from,
    required this.to,
    required this.feature,
  });

  final String id;
  final String type;
  final String from;
  final String to;
  final String feature;

  factory GraphContract.fromJson(Map<String, dynamic> json) => GraphContract(
        id: json['id'] as String? ?? '',
        type: json['type'] as String? ?? 'unknown',
        from: json['from'] as String? ?? '',
        to: json['to'] as String? ?? '',
        feature: json['feature'] as String? ?? '',
      );
}
