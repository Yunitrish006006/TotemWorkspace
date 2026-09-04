import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:totem_workspace_viewer/model/graph_data.dart';
import 'package:totem_workspace_viewer/model/graph_scene.dart';

void main() {
  const fixture = <String, dynamic>{
    'generatedAt': '2026-09-04',
    'snapshot': {'date': '2026-09-04'},
    'modules': [
      {
        'id': 'totem-core',
        'name': 'TotemCore',
        'rankHint': 3,
        'featureGroups': ['Manual Registry', 'Friendship'],
      },
      {
        'id': 'totem-a',
        'name': 'TotemA',
        'rankHint': 1,
        'featureGroups': ['Manual', 'Integration'],
      },
      {'id': 'totem-b', 'name': 'TotemB', 'rankHint': 2},
    ],
    'externalNodes': [
      {'id': 'external:test', 'name': 'External', 'rankHint': 4},
    ],
    'features': [
      {
        'id': 'core.manual',
        'ownerId': 'totem-core',
        'title': 'Manual Registry',
        'summary': 'Shared manual renderer',
      },
      {
        'id': 'core.friendship',
        'ownerId': 'totem-core',
        'title': 'Friendship',
        'summary': 'Friendship API',
      },
      {
        'id': 'a.manual',
        'ownerId': 'totem-a',
        'title': '研究手冊',
        'summary': 'Manual chapter',
      },
      {
        'id': 'a.integration',
        'ownerId': 'totem-a',
        'title': 'Integration',
        'summary': 'Talks to Core and B',
        'softContractIds': ['a-b'],
      },
      {
        'id': 'b.integration',
        'ownerId': 'totem-b',
        'title': 'Integration API',
        'summary': 'B endpoint',
      },
    ],
    'contracts': [
      {
        'id': 'hard:a:core',
        'type': 'hard-core',
        'from': 'totem-a',
        'to': 'totem-core',
        'feature': 'Friendship API',
        'featureIds': ['a.integration', 'core.friendship'],
      },
      {
        'id': 'a-b',
        'type': 'fabric-suggests',
        'from': 'totem-a',
        'to': 'totem-b',
        'feature': 'Optional integration',
        'featureIds': ['a.integration', 'b.integration'],
      },
      {
        'id': 'event:a:b',
        'type': 'eventbus',
        'from': 'totem-a',
        'to': 'totem-b',
        'feature': 'Unbound event contract',
      },
    ],
    'sharedCapabilities': [
      {
        'id': 'shared:manual:totem-a',
        'type': 'shared-capability',
        'family': 'manual',
        'providerModuleId': 'totem-core',
        'consumerModuleId': 'totem-a',
        'providerFeatureId': 'core.manual',
        'providerLabel': 'Manual Registry / Renderer',
        'consumerLabel': 'TotemA shared manual chapter',
        'label': 'Shared Totem Manual',
      },
    ],
  };

  test('core stays at the 3D origin and scene is deterministic', () {
    final data = GraphData.fromJson(fixture);
    final first = buildGraphScene(data, expanded: {'totem-a', 'totem-core'});
    final second = buildGraphScene(data, expanded: {'totem-a', 'totem-core'});
    final core = first.byId['totem-core']!;

    expect(core.position.x, 0);
    expect(core.position.y, 0);
    expect(core.position.z, 0);
    expect(
      first.nodes.map((node) => (node.id, node.position.x, node.position.y, node.position.z)),
      second.nodes.map((node) => (node.id, node.position.x, node.position.y, node.position.z)),
    );
  });

  test('camera projects origin with pan offsets', () {
    const camera = Camera3d(panX: 24, panY: -12);
    final projected = camera.project(Vec3.zero, const Size(1000, 700));
    expect(projected.offset.dx, closeTo(524, 0.001));
    expect(projected.offset.dy, closeTo(338, 0.001));
  });

  test('graph model parses curated features and shared capabilities', () {
    final data = GraphData.fromJson(fixture);
    expect(data.modules, hasLength(3));
    expect(data.features, hasLength(5));
    expect(data.sharedCapabilities.single.providerFeatureId, 'core.manual');
    expect(data.manualFeatureFor('totem-a')?.id, 'a.manual');
  });

  test('expanded contracts retarget to precise feature endpoints', () {
    final data = GraphData.fromJson(fixture);
    final scene = buildGraphScene(data, expanded: {'totem-a', 'totem-b', 'totem-core'});

    expect(
      scene.edges.any((edge) =>
          edge.type == 'hard-core' && edge.from == 'a.integration' && edge.to == 'core.friendship'),
      isTrue,
    );
    expect(
      scene.edges.any((edge) =>
          edge.type == 'fabric-suggests' && edge.from == 'a.integration' && edge.to == 'b.integration'),
      isTrue,
    );
  });

  test('expanded module center fallback edges are suppressed', () {
    final data = GraphData.fromJson(fixture);
    final scene = buildGraphScene(data, expanded: {'totem-a'});

    expect(scene.edges.any((edge) => edge.id == 'event:a:b'), isFalse);
    expect(
      scene.edges.any((edge) => edge.from == 'totem-a' || edge.to == 'totem-a'),
      isFalse,
    );
  });

  test('shared capability connects collapsed consumer module to expanded provider feature', () {
    final data = GraphData.fromJson(fixture);
    final scene = buildGraphScene(data, expanded: {'totem-core'});
    final edge = scene.edges.singleWhere((edge) => edge.type == 'shared-capability');

    expect(edge.from, 'totem-a');
    expect(edge.to, 'core.manual');
  });

  test('shared manual uses curated feature endpoints when both modules are expanded', () {
    final data = GraphData.fromJson(fixture);
    final scene = buildGraphScene(data, expanded: {'totem-a', 'totem-core'});
    final edge = scene.edges.singleWhere((edge) => edge.type == 'shared-capability');

    expect(edge.from, 'a.manual');
    expect(edge.to, 'core.manual');
  });

  test('edge filters remove disabled relationship families', () {
    final data = GraphData.fromJson(fixture);
    final scene = buildGraphScene(
      data,
      enabledFilters: edgeFilterKeys.where((key) => key != 'hard-core').toSet(),
    );
    expect(scene.edges.any((edge) => edge.type == 'hard-core'), isFalse);
  });

  test('multi-relation feature is placed toward the shared target junction', () {
    final data = GraphData.fromJson(fixture);
    final scene = buildGraphScene(data, expanded: {'totem-a'});
    final owner = scene.byId['totem-a']!.position;
    final feature = scene.byId['a.integration']!.position;
    final core = scene.byId['totem-core']!.position;
    final b = scene.byId['totem-b']!.position;
    final targetCentroid = (core + b) * 0.5;

    expect((feature - owner).dot(targetCentroid - owner), greaterThan(0));
  });
}
