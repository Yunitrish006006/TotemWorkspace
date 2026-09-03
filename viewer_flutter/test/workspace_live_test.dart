import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:totem_workspace_viewer/live/workspace_live.dart';

void main() {
  test('local API discovery stays disabled on published Pages', () {
    expect(
      discoverLocalApiBase(pageUri: Uri.parse('https://yunitrish006006.github.io/TotemWorkspace/flutter/')),
      isNull,
    );
  });

  test('Flutter dev server discovers the loopback workspace API', () {
    expect(
      discoverLocalApiBase(pageUri: Uri.parse('http://localhost:54321/')),
      'http://127.0.0.1:8765',
    );
    expect(
      discoverLocalApiBase(pageUri: Uri.parse('http://127.0.0.1:8765/flutter/')),
      'http://127.0.0.1:8765',
    );
  });

  test('explicit local API configuration wins over page origin', () {
    expect(
      discoverLocalApiBase(
        configured: 'http://127.0.0.1:9000/',
        pageUri: Uri.parse('https://example.com/'),
      ),
      'http://127.0.0.1:9000',
    );
  });

  test('workspace status parses dirty, drift, and missing counts', () {
    final status = WorkspaceLiveStatus.fromJson({
      'mode': 'local',
      'generatedAt': '2026-09-04T00:00:00Z',
      'snapshot': {'date': '2026-09-04'},
      'modules': <Object>[
        <String, Object>{
          'id': 'totem-a',
          'repoName': 'TotemA',
          'present': true,
          'head': 'aaaaaaaa',
          'branch': 'main',
          'dirty': true,
          'snapshotMatch': false,
        },
        <String, Object>{
          'id': 'totem-b',
          'repoName': 'TotemB',
          'present': true,
          'head': 'bbbbbbbb',
          'branch': 'main',
          'dirty': false,
          'snapshotMatch': true,
        },
        <String, Object>{
          'id': 'totem-c',
          'repoName': 'TotemC',
          'present': false,
          'dirty': false,
          'snapshotMatch': false,
        },
      ],
    });

    expect(status.dirtyCount, 1);
    expect(status.driftCount, 1);
    expect(status.missingCount, 1);
    expect(status.module('totem-a')?.branch, 'main');
  });

  test('local client reads graph/status and sends incremental refresh request', () async {
    final requests = <http.Request>[];
    final mock = MockClient((request) async {
      requests.add(request);
      if (request.url.path == '/api/health') {
        return http.Response(jsonEncode(<String, Object>{'status': 'ok', 'mode': 'local'}), 200);
      }
      if (request.url.path == '/api/workspace-status') {
        return http.Response(
          jsonEncode(<String, Object>{
            'mode': 'local',
            'generatedAt': 'now',
            'snapshot': <String, Object>{'date': '2026-09-04'},
            'modules': <Object>[],
          }),
          200,
        );
      }
      if (request.url.path == '/api/graph-data') {
        return http.Response(
          jsonEncode(<String, Object>{
            'generatedAt': 'now',
            'snapshot': <String, Object>{'date': '2026-09-04'},
            'modules': <Object>[],
            'features': <Object>[],
            'externalNodes': <Object>[],
            'contracts': <Object>[],
            'sharedCapabilities': <Object>[],
            'code': <String, Object>{'nodes': <Object>[]},
          }),
          200,
        );
      }
      if (request.url.path == '/api/refresh') {
        return http.Response(jsonEncode(<String, Object>{'status': 'ok'}), 200);
      }
      return http.Response('not found', 404);
    });

    final client = LocalWorkspaceClient('http://127.0.0.1:8765', client: mock);
    expect(await client.health(), isTrue);
    expect((await client.workspaceStatus()).mode, 'local');
    expect((await client.graphData()).modules, isEmpty);
    await client.refresh(modules: const <String>['totem-core']);

    final refresh = requests.singleWhere((request) => request.url.path == '/api/refresh');
    expect(refresh.method, 'POST');
    expect(
      jsonDecode(refresh.body),
      const <String, Object>{'modules': <String>['totem-core']},
    );
    client.close();
  });
}
