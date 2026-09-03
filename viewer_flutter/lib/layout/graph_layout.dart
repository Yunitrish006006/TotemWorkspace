import 'dart:math' as math;
import 'dart:ui';

import '../model/graph_data.dart';

class Vec3 {
  const Vec3(this.x, this.y, this.z);

  static const zero = Vec3(0, 0, 0);
  final double x;
  final double y;
  final double z;
}

class VisualNode {
  const VisualNode({
    required this.id,
    required this.label,
    required this.kind,
    required this.rank,
    required this.position,
    this.module,
  });

  final String id;
  final String label;
  final String kind;
  final int rank;
  final Vec3 position;
  final GraphModule? module;
}

class GraphLayoutResult {
  const GraphLayoutResult(this.nodes);

  final List<VisualNode> nodes;

  Map<String, VisualNode> get byId => {for (final node in nodes) node.id: node};
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
  });

  final double yaw;
  final double pitch;
  final double zoom;

  Camera3d copyWith({double? yaw, double? pitch, double? zoom}) => Camera3d(
        yaw: yaw ?? this.yaw,
        pitch: pitch ?? this.pitch,
        zoom: zoom ?? this.zoom,
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
      offset: Offset(size.width / 2 + x * scale, size.height / 2 + y * scale),
      scale: scale,
      depth: z,
    );
  }
}

GraphLayoutResult buildModuleLayout(GraphData data) {
  final nodes = <VisualNode>[];
  final core = data.modules.where((module) => module.id == 'totem-core').firstOrNull;
  if (core != null) {
    nodes.add(VisualNode(
      id: core.id,
      label: core.name,
      kind: 'module',
      rank: core.rankHint,
      position: Vec3.zero,
      module: core,
    ));
  }

  final peripheral = data.modules
      .where((module) => module.id != 'totem-core')
      .toList(growable: false)
    ..sort((a, b) => a.name.compareTo(b.name));
  for (var index = 0; index < peripheral.length; index += 1) {
    final module = peripheral[index];
    nodes.add(VisualNode(
      id: module.id,
      label: module.name,
      kind: 'module',
      rank: module.rankHint,
      position: _fibonacciPoint(index, peripheral.length, 430),
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
      position: _fibonacciPoint(index + 0.65, math.max(1, externals.length + 1), 710),
    ));
  }
  return GraphLayoutResult(List.unmodifiable(nodes));
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

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
