import 'dart:math' as math;
import 'dart:ui';

import 'graph_data.dart';

const edgeFilterKeys = <String>[
  'hard-core',
  'fabric-suggests',
  'runtime-optional',
  'eventbus',
  'observer-provider',
  'external-service',
  'shared-capability',
];

const edgeFilterLabels = <String, String>{
  'hard-core': 'Hard Core',
  'fabric-suggests': 'Fabric suggests',
  'runtime-optional': 'Runtime optional',
  'eventbus': 'EventBus',
  'observer-provider': 'Observer provider',
  'external-service': 'External service',
  'shared-capability': 'Shared capability',
};

class Vec3 {
  const Vec3(this.x, this.y, this.z);

  static const zero = Vec3(0, 0, 0);
  final double x;
  final double y;
  final double z;

  Vec3 operator +(Vec3 other) => Vec3(x + other.x, y + other.y, z + other.z);
  Vec3 operator -(Vec3 other) => Vec3(x - other.x, y - other.y, z - other.z);
  Vec3 operator *(double value) => Vec3(x * value, y * value, z * value);

  double get length => math.sqrt(x * x + y * y + z * z);
  Vec3 get normalized => length < 0.000001 ? zero : this * (1 / length);
  double dot(Vec3 other) => x * other.x + y * other.y + z * other.z;
  Vec3 cross(Vec3 other) => Vec3(
        y * other.z - z * other.y,
        z * other.x - x * other.z,
        x * other.y - y * other.x,
      );
}

class ProjectedPoint {
  const ProjectedPoint({required this.offset, required this.scale, required this.depth});

  final Offset offset;
  final double scale;
  final double depth;
}

class Camera3d {
  const Camera3d({
    this.yaw = -0.48,
    this.pitch = 0.22,
    this.zoom = 1.02,
    this.panX = 0,
    this.panY = 0,
  });

  final double yaw;
  final double pitch;
  final double zoom;
  final double panX;
  final double panY;

  Camera3d copyWith({double? yaw, double? pitch, double? zoom, double? panX, double? panY}) => Camera3d(
        yaw: yaw ?? this.yaw,
        pitch: pitch ?? this.pitch,
        zoom: zoom ?? this.zoom,
        panX: panX ?? this.panX,
        panY: panY ?? this.panY,
      );

  ProjectedPoint project(Vec3 point, Size size) {
    final cy = math.cos(yaw);
    final sy = math.sin(yaw);
    final cp = math.cos(pitch);
    final sp = math.sin(pitch);
    final x = point.x * cy - point.z * sy;
    var z = point.x * sy + point.z * cy;
    final y = point.y * cp - z * sp;
    z = point.y * sp + z * cp;
    final scale = zoom * 820 / math.max(200, 920 + z);
    return ProjectedPoint(
      offset: Offset(size.width / 2 + panX + x * scale, size.height / 2 + panY + y * scale),
      scale: scale,
      depth: z,
    );
  }
}

class VisualNode {
  const VisualNode({
    required this.id,
    required this.label,
    required this.kind,
    required this.rank,
    required this.position,
    this.ownerId,
    this.module,
    this.feature,
    this.capability,
  });

  final String id;
  final String label;
  final String kind;
  final int rank;
  final Vec3 position;
  final String? ownerId;
  final GraphModule? module;
  final GraphFeature? feature;
  final GraphSharedCapability? capability;

  bool get isChild => kind == 'feature' || kind == 'capability';
}

class VisualEdge {
  const VisualEdge({
    required this.id,
    required this.from,
    required this.to,
    required this.type,
    required this.label,
    this.retargeted = false,
  });

  final String id;
  final String from;
  final String to;
  final String type;
  final String label;
  final bool retargeted;
}

class VisualCluster {
  const VisualCluster({required this.ownerId, required this.radius, required this.childCount});

  final String ownerId;
  final double radius;
  final int childCount;
}

class GraphScene {
  const GraphScene({required this.nodes, required this.edges, required this.clusters});

  final List<VisualNode> nodes;
  final List<VisualEdge> edges;
  final List<VisualCluster> clusters;

  Map<String, VisualNode> get byId => {for (final node in nodes) node.id: node};

  String? ownerOf(String id) {
    final node = byId[id];
    if (node == null) return null;
    return node.ownerId ?? (node.kind == 'module' ? node.id : null);
  }
}

class _Relation {
  const _Relation(this.targetId, this.weight);
  final String targetId;
  final double weight;
}

GraphScene buildGraphScene(
  GraphData data, {
  Set<String> expanded = const {},
  Set<String> enabledFilters = const {
    'hard-core',
    'fabric-suggests',
    'runtime-optional',
    'eventbus',
    'observer-provider',
    'external-service',
    'shared-capability',
  },
}) {
  final nodes = <VisualNode>[];
  final edges = <VisualEdge>[];
  final clusters = <VisualCluster>[];
  final moduleRadius = _moduleOrbitRadius(expanded.length);
  final externalRadius = moduleRadius + 280;
  final core = data.moduleById('totem-core');
  final peripheral = data.modules.where((module) => module.id != 'totem-core').toList(growable: false)
    ..sort((a, b) => a.name.compareTo(b.name));

  if (core != null) {
    nodes.add(VisualNode(
      id: core.id,
      label: core.name,
      kind: 'module',
      rank: core.rankHint,
      position: Vec3.zero,
      ownerId: core.id,
      module: core,
    ));
  }

  for (var index = 0; index < peripheral.length; index += 1) {
    final module = peripheral[index];
    nodes.add(VisualNode(
      id: module.id,
      label: module.name,
      kind: 'module',
      rank: module.rankHint,
      position: _fibonacciPoint(index, peripheral.length, moduleRadius),
      ownerId: module.id,
      module: module,
    ));
  }

  final externals = [...data.externalNodes]..sort((a, b) => a.name.compareTo(b.name));
  for (var index = 0; index < externals.length; index += 1) {
    final external = externals[index];
    nodes.add(VisualNode(
      id: external.id,
      label: external.name,
      kind: 'external',
      rank: external.rankHint,
      position: _fibonacciPoint(index + 0.65, math.max(1, externals.length + 1), externalRadius),
    ));
  }

  final anchors = {for (final node in nodes) node.id: node.position};
  for (final moduleId in expanded.toList()..sort()) {
    final parent = nodes.where((node) => node.id == moduleId).firstOrNull;
    if (parent == null) continue;
    final moduleFeatures = data.features.where((feature) => feature.ownerId == moduleId).toList(growable: false);
    final syntheticCapabilities = data.sharedCapabilities.where((capability) {
      if (capability.consumerModuleId != moduleId) return false;
      return _capabilityConsumerEndpoint(data, capability, expanded).startsWith('capability-node:');
    }).toList(growable: false);
    final radius = _clusterRadius(moduleFeatures.length + syntheticCapabilities.length);
    clusters.add(VisualCluster(
      ownerId: moduleId,
      radius: radius,
      childCount: moduleFeatures.length + syntheticCapabilities.length,
    ));

    for (final feature in moduleFeatures) {
      final relations = _featureRelations(data, moduleId, feature);
      final position = _relationAwareScatter(
        parent.position,
        feature.id,
        'feature',
        radius,
        moduleId,
        anchors,
        relations,
      );
      nodes.add(VisualNode(
        id: feature.id,
        label: '${_moduleShort(data, moduleId)} · ${feature.title}',
        kind: 'feature',
        rank: parent.rank,
        position: position,
        ownerId: moduleId,
        feature: feature,
      ));
    }

    for (final capability in syntheticCapabilities) {
      final id = 'capability-node:${capability.id}';
      final position = _relationAwareScatter(
        parent.position,
        id,
        'capability',
        radius,
        moduleId,
        anchors,
        [_Relation(capability.providerModuleId, _relationWeight('shared-capability'))],
      );
      nodes.add(VisualNode(
        id: id,
        label: '${_moduleShort(data, moduleId)} · SHARED MANUAL',
        kind: 'capability',
        rank: parent.rank,
        position: position,
        ownerId: moduleId,
        capability: capability,
      ));
    }
  }

  for (final contract in data.contracts) {
    if (!enabledFilters.contains(contract.type)) continue;
    _addContractEdges(data, nodes, edges, contract, expanded);
  }

  if (enabledFilters.contains('shared-capability')) {
    for (final capability in data.sharedCapabilities) {
      if (!expanded.contains(capability.consumerModuleId)) continue;
      final from = _capabilityConsumerEndpoint(data, capability, expanded);
      var to = capability.providerModuleId;
      final providerFeatureId = capability.providerFeatureId;
      if (expanded.contains(capability.providerModuleId) &&
          providerFeatureId != null &&
          data.featureById(providerFeatureId) != null) {
        to = providerFeatureId;
      }
      if (_expandedCenterEndpoint(data, expanded, from) || _expandedCenterEndpoint(data, expanded, to)) {
        continue;
      }
      if (!nodes.any((node) => node.id == from) || !nodes.any((node) => node.id == to)) continue;
      edges.add(VisualEdge(
        id: capability.id,
        from: from,
        to: to,
        type: 'shared-capability',
        label: capability.label,
        retargeted: true,
      ));
    }
  }

  return GraphScene(
    nodes: List.unmodifiable(nodes),
    edges: List.unmodifiable(edges),
    clusters: List.unmodifiable(clusters),
  );
}

void _addContractEdges(
  GraphData data,
  List<VisualNode> nodes,
  List<VisualEdge> edges,
  GraphContract contract,
  Set<String> expanded,
) {
  if (contract.from.isEmpty || contract.to.isEmpty) return;
  if (!_isRetargetable(contract) || contract.featureIds.isEmpty) {
    if (_expandedCenterEndpoint(data, expanded, contract.from) ||
        _expandedCenterEndpoint(data, expanded, contract.to)) {
      return;
    }
    if (!nodes.any((node) => node.id == contract.from) || !nodes.any((node) => node.id == contract.to)) return;
    edges.add(VisualEdge(
      id: contract.id,
      from: contract.from,
      to: contract.to,
      type: contract.type,
      label: contract.feature.isEmpty ? contract.id : contract.feature,
    ));
    return;
  }

  final fromIds = _endpoints(data, contract, contract.from, expanded);
  final toIds = _endpoints(data, contract, contract.to, expanded);
  for (final from in fromIds) {
    for (final to in toIds) {
      if (_expandedCenterEndpoint(data, expanded, from) || _expandedCenterEndpoint(data, expanded, to)) continue;
      if (!nodes.any((node) => node.id == from) || !nodes.any((node) => node.id == to)) continue;
      edges.add(VisualEdge(
        id: '${contract.id}:$from:$to',
        from: from,
        to: to,
        type: contract.type,
        label: contract.feature.isEmpty ? contract.id : contract.feature,
        retargeted: from != contract.from || to != contract.to,
      ));
    }
  }
}

bool _isRetargetable(GraphContract contract) =>
    contract.type == 'fabric-suggests' ||
    contract.type == 'runtime-optional' ||
    (contract.type == 'hard-core' && contract.featureIds.isNotEmpty);

List<String> _endpoints(GraphData data, GraphContract contract, String ownerId, Set<String> expanded) {
  if (!expanded.contains(ownerId)) return [ownerId];
  final ids = contract.featureIds.where((id) => data.featureById(id)?.ownerId == ownerId).toList(growable: false);
  return ids.isEmpty ? [ownerId] : ids;
}

bool _expandedCenterEndpoint(GraphData data, Set<String> expanded, String id) =>
    data.moduleById(id) != null && expanded.contains(id);

String _capabilityConsumerEndpoint(GraphData data, GraphSharedCapability capability, Set<String> expanded) {
  final explicit = capability.consumerFeatureId == null ? null : data.featureById(capability.consumerFeatureId!);
  final inferred = explicit ?? data.manualFeatureFor(capability.consumerModuleId);
  if (expanded.contains(capability.consumerModuleId) && inferred != null) return inferred.id;
  return 'capability-node:${capability.id}';
}

List<_Relation> _featureRelations(GraphData data, String ownerId, GraphFeature feature) {
  final merged = <String, double>{};
  void add(String targetId, double weight) {
    if (targetId.isEmpty || targetId == ownerId) return;
    merged[targetId] = (merged[targetId] ?? 0) + weight;
  }

  final declared = feature.contractIds.toSet();
  for (final contract in data.contracts) {
    final featureBound = contract.featureIds.contains(feature.id) || declared.contains(contract.id);
    if (!featureBound) continue;
    if (contract.from == ownerId) {
      add(contract.to, _relationWeight(contract.type));
    } else if (contract.to == ownerId) {
      add(contract.from, _relationWeight(contract.type));
    }
  }

  for (final capability in data.sharedCapabilities) {
    final explicit = capability.consumerFeatureId == null ? null : data.featureById(capability.consumerFeatureId!);
    final consumerFeature = explicit ?? data.manualFeatureFor(capability.consumerModuleId);
    if (capability.providerFeatureId == feature.id && capability.providerModuleId == ownerId) {
      add(capability.consumerModuleId, _relationWeight('shared-capability'));
    }
    if (consumerFeature?.id == feature.id && capability.consumerModuleId == ownerId) {
      add(capability.providerModuleId, _relationWeight('shared-capability'));
    }
  }

  final result = merged.entries.map((entry) => _Relation(entry.key, entry.value)).toList(growable: false)
    ..sort((a, b) => a.targetId.compareTo(b.targetId));
  return result;
}

double _relationWeight(String type) => switch (type) {
      'hard-core' => 1.7,
      'shared-capability' => 1.55,
      'fabric-suggests' => 1.4,
      'runtime-optional' => 1.3,
      'external-service' => 1.25,
      'eventbus' || 'observer-provider' => 1.2,
      _ => 1.0,
    };

Vec3 _relationAwareScatter(
  Vec3 parent,
  String id,
  String type,
  double radius,
  String ownerId,
  Map<String, Vec3> anchors,
  List<_Relation> relations,
) {
  final base = _scatter(parent, id, type, radius);
  final offset = base - parent;
  final radialDistance = offset.length;
  final baseDirection = offset.normalized;
  final outward = ownerId == 'totem-core' ? null : parent.normalized;

  if (relations.isEmpty) {
    if (outward == null) return base;
    final direction = (baseDirection * 0.72 + outward * 0.28).normalized;
    return parent + direction * radialDistance;
  }

  var centroid = Vec3.zero;
  var totalWeight = 0.0;
  final resolved = <_Relation>[];
  for (final relation in relations) {
    final target = anchors[relation.targetId];
    if (target == null) continue;
    centroid = centroid + target * relation.weight;
    totalWeight += relation.weight;
    resolved.add(relation);
  }
  if (resolved.isEmpty || totalWeight <= 0) return base;
  centroid = centroid * (1 / totalWeight);
  var junctionDirection = (centroid - parent).normalized;
  if (junctionDirection.length < 0.000001) junctionDirection = baseDirection;

  final hasCoreTarget = resolved.any((relation) => relation.targetId == 'totem-core');
  if (outward != null && !hasCoreTarget) {
    final inwardness = junctionDirection.dot(outward);
    if (inwardness < -0.18) {
      final correction = 0.42 + inwardness.abs() * 0.45;
      junctionDirection = (junctionDirection + outward * correction).normalized;
    }
  }

  final degree = resolved.length;
  final influence = math.min(
    0.9,
    0.38 + math.log(degree + 1) / math.log(2) * 0.17 + math.min(0.18, totalWeight * 0.035),
  ).toDouble();
  var direction = (baseDirection * (1 - influence) + junctionDirection * influence).normalized;
  final axis = direction.y.abs() < 0.86 ? const Vec3(0, 1, 0) : const Vec3(1, 0, 0);
  final tangentA = direction.cross(axis).normalized;
  final tangentB = direction.cross(tangentA).normalized;
  final phase = _hashUnit(id, 131) * math.pi * 2;
  final slotStrength = 0.22 / math.sqrt(math.max(1, degree));
  final tangent = tangentA * math.cos(phase) + tangentB * math.sin(phase);
  direction = (direction + tangent * slotStrength).normalized;
  return parent + direction * radialDistance;
}

double _clusterRadius(int count) => math.min(245, 118 + math.sqrt(math.max(1, count)) * 27).toDouble();

double _moduleOrbitRadius(int count) => count <= 0 ? 330 : math.min(630, 430 + math.sqrt(count) * 55).toDouble();

Vec3 _scatter(Vec3 parent, String id, String type, double radius) {
  final u = _hashUnit(id, 17);
  final v = _hashUnit(id, 53);
  final q = _hashUnit(id, 97);
  final z = 2 * u - 1;
  final ring = math.sqrt(math.max(0, 1 - z * z));
  final theta = 2 * math.pi * v;
  final range = type == 'capability' ? const [0.56, 0.78] : const [0.34, 0.64];
  final rr = radius * (range[0] + (range[1] - range[0]) * q);
  return parent + Vec3(ring * math.cos(theta) * rr, z * rr, ring * math.sin(theta) * rr);
}

double _hashUnit(String text, int salt) {
  var h = (2166136261 ^ salt) & 0xffffffff;
  for (final codeUnit in text.codeUnits) {
    h ^= codeUnit;
    h = (h * 16777619) & 0xffffffff;
  }
  h ^= h >> 16;
  h = (h * 2246822507) & 0xffffffff;
  h ^= h >> 13;
  return (h & 0xffffffff) / 4294967295;
}

Vec3 _fibonacciPoint(num index, int count, double radius) {
  if (count <= 0) return Vec3.zero;
  final unitIndex = (index.toDouble() + 0.5) / count;
  final y = 1 - 2 * unitIndex;
  final ring = math.sqrt(math.max(0, 1 - y * y));
  final angle = math.pi * (3 - math.sqrt(5)) * index.toDouble();
  return Vec3(
    math.cos(angle) * ring * radius,
    y * radius,
    math.sin(angle) * ring * radius,
  );
}

String _moduleShort(GraphData data, String id) => (data.moduleById(id)?.name ?? id).replaceFirst(RegExp(r'^Totem'), '');

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
