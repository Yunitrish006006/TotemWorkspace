import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:totem_workspace_viewer/live/workspace_live.dart';

void main() {
  test('published TotemWorkspace Pages discover the loopback workspace API', () {
    expect(
      discoverLocalApiBase(pageUri: Uri.parse('https://yunitrish006006.github.io/TotemWorkspace/')),
      'http://127.0.0.1:18765',
    );
    expect(
      discoverLocalApiBase(pageUri: Uri.parse('https://yunitrish006006.github.io/TotemWorkspace/legacy/')),
      'http://127.0.0.1:18765',
    );
    expect(
      discoverLocalApiBase(pageUri: Uri.parse('https://example.com/')),
      isNull,
    );
  });

  test('Flutter dev server discovers the loopback workspace API', () {
    expect(
      discoverLocalApiBase(pageUri: Uri.parse('http://localhost:54321/')),
      'http://127.0.0.1:18765',
    );
    expect(
      discoverLocalApiBase(pageUri: Uri.parse('http://127.0.0.1:18765/flutter/')),
      'http://127.0.0.1:18765',
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
            'verification': <String, Object>{
              'schemaVersion': 1,
              'generatedAt': 'now',
              'tests': <Object>[],
              'relations': <Object>[],
              'requirements': <Object>[],
              'coverage': <Object>[],
            },
            'code': <String, Object>{'nodes': <Object>[]},
          }),
          200,
        );
      }
      if (request.url.path == '/api/viewer-settings') {
        if (request.method == 'POST') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode(<String, Object>{
              'schemaVersion': 1,
              'promptEnabled': body['promptEnabled'] as bool? ?? false,
              'agentActivityEnabled': true,
              'changeAnimationsEnabled': true,
              'autoExpandAgentFocus': true,
              'replayEnabled': true,
            }),
            200,
          );
        }
        return http.Response(
          jsonEncode(<String, Object>{
            'schemaVersion': 1,
            'promptEnabled': false,
            'agentActivityEnabled': true,
            'changeAnimationsEnabled': true,
            'autoExpandAgentFocus': true,
            'replayEnabled': true,
          }),
          200,
        );
      }
      if (request.url.path == '/api/verification-state') {
        return http.Response(
          jsonEncode(<String, Object>{
            'schemaVersion': 1,
            'generatedAt': 'now',
            'updatedAt': 'now',
            'entries': <Object>[
              <String, Object>{
                'target': 'test:totem-core:src/test/CoreTest.java',
                'status': 'failed',
                'sequence': 9,
                'timestamp': 'now',
                'summary': 'fixture failed',
                'resolved': true,
                'testId': 'test:totem-core:src/test/CoreTest.java',
                'moduleId': 'totem-core',
                'featureIds': <String>['totem-core.feature-5'],
                'componentIds': <String>['component:totem-core:api'],
                'contractIds': <String>[],
                'capabilityIds': <String>[],
              },
            ],
            'summary': <String, Object>{
              'running': 0,
              'passed': 0,
              'failed': 1,
              'unresolved': 0,
            },
            'runningTargetIds': <String>[],
            'passedTargetIds': <String>[],
            'failedTargetIds': <String>[
              'test:totem-core:src/test/CoreTest.java',
              'totem-core',
              'totem-core.feature-5',
              'component:totem-core:api',
            ],
            'activePlan': <String, Object>{
              'modules': <String>['totem-core'],
              'risks': <String>['shared-contract'],
              'requiredCategories': <String>['unit-tests', 'cross-module-build'],
              'requirementIds': <String>[],
            },
          }),
          200,
        );
      }
      if (request.url.path == '/api/change-intelligence') {
        return http.Response(jsonEncode(<String, Object>{
            'schemaVersion': 1,
            'generatedAt': 'now',
            'before': <String, Object>{'entityCount': 10},
            'after': <String, Object>{'entityCount': 12},
            'gitChanges': <Object>[
              <String, Object>{
                'moduleId': 'totem-core',
                'repoName': 'TotemCore',
                'status': 'M',
                'path': 'src/main/java/example/Core.java',
                'componentIds': <String>['component:totem-core:api'],
                'featureIds': <String>['totem-core.feature-5'],
                'implementationIds': <String>['implementation:component:totem-core:api:src/main/java/example/Core.java'],
              },
            ],
            'semanticDiff': <String, Object>{
              'added': <Object>[],
              'modified': <Object>[
                <String, Object>{
                  'id': 'component:totem-core:api',
                  'type': 'component',
                  'moduleId': 'totem-core',
                  'moduleIds': <String>['totem-core'],
                },
              ],
              'removed': <Object>[],
              'changedEntityIds': <String>['component:totem-core:api'],
            },
            'affectedEntityIds': <String>[
              'totem-core',
              'totem-core.feature-5',
              'component:totem-core:api',
              'implementation:component:totem-core:api:src/main/java/example/Core.java',
            ],
            'impact': <String, Object>{
              'touchedModules': <String>['totem-core'],
              'impactedModules': <String>['totem-core', 'totem-alchemy'],
              'contractIds': <String>['hard:totem-alchemy:totem-core'],
              'risks': <String>['shared-contract'],
              'requiresIndependentReview': true,
            },
          }), 200);
      }
      if (request.url.path == '/api/activity') {
        return http.Response(
          jsonEncode(<String, Object>{
            'schemaVersion': 1,
            'latestSequence': 3,
            'events': <Object>[
              <String, Object>{
                'sequence': 3,
                'timestamp': 'now',
                'type': 'file_edit',
                'source': 'agent-adapter',
                'moduleId': 'totem-core',
                'featureId': 'totem-core.feature-5',
                'summary': 'editing outline api',
              },
            ],
          }),
          200,
        );
      }
      if (request.url.path == '/api/prompt') {
        return http.Response(
          jsonEncode(<String, Object>{
            'status': 'accepted',
            'execution': 'agent-adapter-required',
            'event': <String, Object>{
              'sequence': 4,
              'timestamp': 'now',
              'type': 'prompt_submitted',
              'source': 'viewer',
              'summary': 'inspect outline api',
            },
          }),
          202,
        );
      }
      if (request.url.path == '/api/refresh') {
        return http.Response(
          jsonEncode(<String, Object>{
            'status': 'ok',
            'changeIntelligence': <String, Object>{
            'schemaVersion': 1,
            'generatedAt': 'now',
            'before': <String, Object>{'entityCount': 10},
            'after': <String, Object>{'entityCount': 12},
            'gitChanges': <Object>[
              <String, Object>{
                'moduleId': 'totem-core',
                'repoName': 'TotemCore',
                'status': 'M',
                'path': 'src/main/java/example/Core.java',
                'componentIds': <String>['component:totem-core:api'],
                'featureIds': <String>['totem-core.feature-5'],
                'implementationIds': <String>['implementation:component:totem-core:api:src/main/java/example/Core.java'],
              },
            ],
            'semanticDiff': <String, Object>{
              'added': <Object>[],
              'modified': <Object>[
                <String, Object>{
                  'id': 'component:totem-core:api',
                  'type': 'component',
                  'moduleId': 'totem-core',
                  'moduleIds': <String>['totem-core'],
                },
              ],
              'removed': <Object>[],
              'changedEntityIds': <String>['component:totem-core:api'],
            },
            'impact': <String, Object>{
              'touchedModules': <String>['totem-core'],
              'impactedModules': <String>['totem-core', 'totem-alchemy'],
              'contractIds': <String>['hard:totem-alchemy:totem-core'],
              'risks': <String>['shared-contract'],
              'requiresIndependentReview': true,
            },
          },
          }),
          200,
        );
      }
      return http.Response('not found', 404);
    });

    final client = LocalWorkspaceClient('http://127.0.0.1:18765', client: mock);
    expect(await client.health(), isTrue);
    expect((await client.workspaceStatus()).mode, 'local');
    expect((await client.graphData()).modules, isEmpty);

    final settings = await client.viewerSettings();
    expect(settings.promptEnabled, isFalse);
    expect(settings.agentActivityEnabled, isTrue);

    final updated = await client.updateViewerSettings(settings.copyWith(promptEnabled: true));
    expect(updated.promptEnabled, isTrue);

    final activity = await client.activity(after: 2);
    expect(activity.latestSequence, 3);
    expect(activity.events.single.type, 'file_edit');
    expect(activity.events.single.targetLabel, 'totem-core.feature-5');

    final promptEvent = await client.submitPrompt('inspect outline api');
    expect(promptEvent.type, 'prompt_submitted');

    final verification = await client.verificationState();
    expect(verification.failedCount, 1);
    expect(verification.hasFailures, isTrue);
    expect(verification.failedTargetIds, contains('totem-core.feature-5'));
    expect(verification.activePlan.requiredCategories, contains('cross-module-build'));

    final initialChange = await client.changeIntelligence();
    expect(initialChange.gitChanges.single.moduleId, 'totem-core');
    expect(initialChange.semanticDiff.changedEntityIds, contains('component:totem-core:api'));
    expect(initialChange.changedEntityIds, contains('totem-core.feature-5'));
    expect(initialChange.changedEntityIds, contains('implementation:component:totem-core:api:src/main/java/example/Core.java'));
    expect(initialChange.impact.impactedModules, contains('totem-alchemy'));

    final refreshChange = await client.refresh(modules: const <String>['totem-core']);
    expect(refreshChange.hasChanges, isTrue);
    expect(refreshChange.beforeEntityCount, 10);
    expect(refreshChange.afterEntityCount, 12);

    final settingsUpdate = requests.singleWhere(
      (request) => request.url.path == '/api/viewer-settings' && request.method == 'POST',
    );
    expect((jsonDecode(settingsUpdate.body) as Map<String, dynamic>)['promptEnabled'], isTrue);

    final activityRequest = requests.singleWhere((request) => request.url.path == '/api/activity');
    expect(activityRequest.url.queryParameters['after'], '2');

    final promptRequest = requests.singleWhere((request) => request.url.path == '/api/prompt');
    expect((jsonDecode(promptRequest.body) as Map<String, dynamic>)['prompt'], 'inspect outline api');

    final refresh = requests.singleWhere((request) => request.url.path == '/api/refresh');
    expect(refresh.method, 'POST');
    expect(
      jsonDecode(refresh.body),
      const <String, Object>{'modules': <String>['totem-core']},
    );
    client.close();
  });
}
