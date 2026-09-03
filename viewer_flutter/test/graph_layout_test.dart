import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:totem_workspace_viewer/layout/graph_layout.dart';
import 'package:totem_workspace_viewer/model/graph_data.dart';

void main() {
  const fixture = <String, dynamic>{
    'generatedAt': '2026-09-04',
    'snapshot': {'date': '2026-09-04'},
    'modules': [
      {'id': 'totem-core', 'name': 'TotemCore', 'rankHint': 3},
      {'id': 'totem-a', 'name': 'TotemA', 'rankHint': 1},
      {'id': 'totem-b', 'name': 'TotemB', 'rankHint': 2},
    ],
    'externalNodes': [
      {'id': 'external:test', 'name': 'External', 'rankHint': 4},
    ],
    'contracts': [
      {'id': 'hard:a:core', 'type': 'hard-core', 'from': 'totem-a', 'to': 'totem-core'},
    ],
  };

  test('core stays at the 3D origin and layout is deterministic', () {
    final data = GraphData.fromJson(fixture);
    final first = buildModuleLayout(data);
    final second = buildModuleLayout(data);
    final core = first.byId['totem-core']!;

    expect(core.position.x, 0);
    expect(core.position.y, 0);
    expect(core.position.z, 0);
    expect(first.nodes.map((node) => (node.id, node.position.x, node.position.y, node.position.z)),
        second.nodes.map((node) => (node.id, node.position.x, node.position.y, node.position.z)));
  });

  test('camera projects origin to viewport center', () {
    const camera = Camera3d();
    final projected = camera.project(Vec3.zero, const Size(1000, 700));
    expect(projected.offset.dx, closeTo(500, 0.001));
    expect(projected.offset.dy, closeTo(350, 0.001));
  });

  test('graph model parses module and contract counts', () {
    final data = GraphData.fromJson(fixture);
    expect(data.modules, hasLength(3));
    expect(data.contracts.single.type, 'hard-core');
    expect(data.externalNodes.single.id, 'external:test');
  });
}
