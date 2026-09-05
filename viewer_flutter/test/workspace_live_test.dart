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
          'recentChanges': <String, Object>{
            'summary': 'feat(i18n): add Japanese translations',
            'timestamp': '2026-09-05T00:00:00Z',
            'files': <Object>[
              <String, Object>{'status': 'A', 'path': 'src/main/resources/assets/totem/lang/ja_jp.json'},
            ],
          },
          'locales': <String, Object>{
            'ja_jp': <String, Object>{
              'applicable': true,
              'sourceFiles': 2,
              'presentFiles': 2,
              'validFiles': 2,
              'sourceKeys': 10,
              'translatedKeys': 7,
              'missingKeys': 3,
              'complete': false,
            },
          },
        },
        <String, Object>{
          'id': 'totem-b',
          'repoName': 'TotemB',
          'present': true,
          'head': 'bbbbbbbb',
          'branch': 'main',
          'dirty': false,
          'snapshotMatch': true,
          'locales': <String, Object>{
            'ja_jp': <String, Object>{
              'applicable': true,
              'sourceFiles': 1,
              'presentFiles': 1,
              'validFiles': 1,
              'sourceKeys': 3,
              'translatedKeys': 3,
              'missingKeys': 0,
              'complete': true,
            },
          },
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
    expect(status.japaneseRequiredCount, 2);
    expect(status.japaneseCompleteCount, 1);
    expect(status.module('totem-a')?.japanese?.missingKeys, 3);
    expect(status.module('totem-a')?.recentChanges?.files.single.path, 'src/main/resources/assets/totem/lang/ja_jp.json');
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
      if (request.url.path == '/api/replay') {
        return http.Response(
          jsonEncode(<String, Object>{
            'schemaVersion': 1,
            'generatedAt': 'now',
            'updatedAt': 'now',
            'earliestSequence': 1,
            'latestSequence': 9,
            'eventCount': 9,
            'sessions': <Object>[
              <String, Object?>{
                'id': 'session:task:flutter-fixture:1',
                'taskId': 'task:flutter-fixture:1',
                'state': 'completed',
                'startedSequence': 2,
                'endedSequence': 8,
                'startedAt': 'now',
                'endedAt': 'now',
                'moduleId': 'totem-core',
                'featureId': 'totem-core.feature-5',
                'summary': 'fixture task',
                'eventCount': 7,
                'milestoneCount': 1,
                'milestones': <Object>[
                  <String, Object?>{
                    'sequence': 7,
                    'timestamp': 'now',
                    'type': 'commit_created',
                    'taskId': 'task:flutter-fixture:1',
                    'sessionId': 'session:task:flutter-fixture:1',
                    'moduleId': 'totem-core',
                    'summary': 'abc1234',
                  },
                ],
              },
            ],
            'milestones': <Object>[
              <String, Object?>{
                'sequence': 7,
                'timestamp': 'now',
                'type': 'commit_created',
                'taskId': 'task:flutter-fixture:1',
                'sessionId': 'session:task:flutter-fixture:1',
                'moduleId': 'totem-core',
                'summary': 'abc1234',
              },
            ],
          }),
          200,
        );
      }
      if (request.url.path == '/api/replay/frame') {
        return http.Response(
          jsonEncode(<String, Object?>{
            'schemaVersion': 1,
            'generatedAt': 'now',
            'sequence': int.tryParse(request.url.queryParameters['sequence'] ?? '') ?? 5,
            'latestSequence': 9,
            'live': false,
            'activity': <String, Object>{
              'sequence': 5,
              'timestamp': 'now',
              'type': 'test_failed',
              'source': 'agent-adapter',
              'moduleId': 'totem-core',
              'featureId': 'totem-core.feature-5',
              'test': 'test:totem-core:src/test/CoreTest.java',
              'summary': 'fixture failed',
            },
            'changeIntelligence': <String, Object>{
              'schemaVersion': 1,
              'generatedAt': 'now',
              'before': <String, Object>{'entityCount': 10},
              'after': <String, Object>{'entityCount': 12},
              'gitChanges': <Object>[],
              'semanticDiff': <String, Object>{
                'added': <Object>[],
                'modified': <Object>[],
                'removed': <Object>[],
                'changedEntityIds': <String>['component:totem-core:api'],
              },
              'affectedEntityIds': <String>['totem-core', 'component:totem-core:api'],
              'impact': <String, Object>{
                'touchedModules': <String>['totem-core'],
                'impactedModules': <String>['totem-core'],
                'contractIds': <String>[],
                'risks': <String>[],
                'requiresIndependentReview': false,
              },
            },
            'graphState': <String, Object>{
              'schemaVersion': 5,
              'generatedAt': 'now',
              'entityIds': <String>['totem-core', 'totem-core.feature-5', 'component:totem-core:api'],
              'relations': <Object>[],
            },
            'verificationState': <String, Object>{
              'schemaVersion': 1,
              'generatedAt': 'now',
              'updatedAt': 'now',
              'entries': <Object>[],
              'summary': <String, Object>{
                'running': 0,
                'passed': 0,
                'failed': 1,
                'unresolved': 0,
              },
              'runningTargetIds': <String>[],
              'passedTargetIds': <String>[],
              'failedTargetIds': <String>['totem-core', 'totem-core.feature-5'],
              'activePlan': <String, Object>{
                'modules': <String>['totem-core'],
                'risks': <String>[],
                'requiredCategories': <String>['unit-tests'],
                'requirementIds': <String>[],
              },
            },
            'milestones': <Object>[
              <String, Object?>{
                'sequence': 7,
                'timestamp': 'now',
                'type': 'commit_created',
                'taskId': 'task:flutter-fixture:1',
                'sessionId': 'session:task:flutter-fixture:1',
                'moduleId': 'totem-core',
                'summary': 'abc1234',
              },
            ],
          }),
          200,
        );
      }
      if (request.url.path == '/api/orchestration-plan') {
        return http.Response(
          jsonEncode(<String, Object?>{
            'schemaVersion': 1,
            'mode': 'bounded-parallel',
            'score': 7,
            'estimatedBenefit': 'high',
            'rationale': <String, Object>{
              'modules': <String>['totem-core', 'totem-alchemy'],
            },
            'assignments': <Object>[
              <String, Object>{
                'id': 'explorer:scope',
                'role': 'explorer',
                'modules': <String>['totem-core', 'totem-alchemy'],
                'phase': 'discovery',
                'writeAllowed': false,
                'purpose': 'confirm scope',
              },
              <String, Object>{
                'id': 'worker:totem-core',
                'role': 'worker',
                'modules': <String>['totem-core'],
                'phase': 'implementation',
                'writeAllowed': true,
                'purpose': 'bounded implementation',
              },
            ],
            'limits': <String, Object>{
              'maxSubagents': 4,
              'maxParallelWorkers': 1,
            },
          }),
          200,
        );
      }
      if (request.url.path == '/api/agent-adapter') {
        return http.Response(
          jsonEncode(<String, Object?>{
            'schemaVersion': 1,
            'kind': 'codex',
            'configured': true,
            'available': true,
            'busy': false,
            'version': 'codex-cli fixture',
            'sandbox': 'workspace-write',
            'model': 'fixture-model',
            'reason': '',
            'currentTask': <String, Object?>{
              'schemaVersion': 1,
              'id': 'task:flutter-fixture:current',
              'adapter': 'codex',
              'state': 'running',
              'startedAt': 'now',
              'orchestration': <String, Object>{
                'mode': 'bounded-parallel',
                'score': 7,
                'modules': <String>['totem-core', 'totem-alchemy'],
                'subagents': 2,
                'roles': <String>['explorer', 'worker'],
                'maxParallelWorkers': 1,
                'estimatedBenefit': 'high',
              },
            },
            'lastTask': null,
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
            'execution': 'codex',
            'event': <String, Object>{
              'sequence': 4,
              'timestamp': 'now',
              'type': 'prompt_submitted',
              'source': 'viewer',
              'summary': 'inspect outline api',
            },
            'task': <String, Object?>{
              'schemaVersion': 1,
              'id': 'task:flutter-fixture:1',
              'adapter': 'codex',
              'state': 'running',
              'startedAt': 'now',
              'orchestration': <String, Object>{
                'mode': 'bounded-parallel',
                'score': 7,
                'modules': <String>['totem-core', 'totem-alchemy'],
                'subagents': 2,
                'roles': <String>['explorer', 'worker'],
                'maxParallelWorkers': 1,
                'estimatedBenefit': 'high',
              },
            },
            'orchestration': <String, Object?>{
              'schemaVersion': 1,
              'mode': 'bounded-parallel',
              'score': 7,
              'estimatedBenefit': 'high',
              'rationale': <String, Object>{
                'modules': <String>['totem-core', 'totem-alchemy'],
              },
              'assignments': <Object>[
                <String, Object>{
                  'id': 'explorer:scope',
                  'role': 'explorer',
                  'modules': <String>['totem-core', 'totem-alchemy'],
                  'phase': 'discovery',
                  'writeAllowed': false,
                  'purpose': 'confirm scope',
                },
                <String, Object>{
                  'id': 'worker:totem-core',
                  'role': 'worker',
                  'modules': <String>['totem-core'],
                  'phase': 'implementation',
                  'writeAllowed': true,
                  'purpose': 'bounded implementation',
                },
              ],
              'limits': <String, Object>{
                'maxSubagents': 4,
                'maxParallelWorkers': 1,
              },
            },
            'adapter': <String, Object>{
              'schemaVersion': 1,
              'kind': 'codex',
              'configured': true,
              'available': true,
              'busy': true,
              'version': 'codex-cli fixture',
              'sandbox': 'workspace-write',
              'currentTask': <String, Object?>{
                'schemaVersion': 1,
                'id': 'task:flutter-fixture:1',
                'adapter': 'codex',
                'state': 'running',
                'startedAt': 'now',
                'orchestration': <String, Object>{
                  'mode': 'bounded-parallel',
                  'score': 7,
                  'modules': <String>['totem-core', 'totem-alchemy'],
                  'subagents': 2,
                  'roles': <String>['explorer', 'worker'],
                  'maxParallelWorkers': 1,
                  'estimatedBenefit': 'high',
                },
              },
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

    final adapter = await client.agentAdapterStatus();
    expect(adapter.kind, 'codex');
    expect(adapter.available, isTrue);
    expect(adapter.label, 'CODEX READY');

    expect(adapter.currentTask?.orchestration?.mode, 'bounded-parallel');
    expect(adapter.currentTask?.orchestration?.subagents, 2);

    final orchestration = await client.orchestrationPlan(
      'inspect outline api',
      moduleId: 'totem-core',
    );
    expect(orchestration.mode, 'bounded-parallel');
    expect(orchestration.score, 7);
    expect(orchestration.assignments.length, 2);
    expect(orchestration.assignments.last.writeAllowed, isTrue);
    expect(orchestration.summary.roles, contains('worker'));

    final replayTimeline = await client.replayTimeline();
    expect(replayTimeline.eventCount, 9);
    expect(replayTimeline.latestSequence, 9);
    expect(replayTimeline.sessions.single.state, 'completed');
    expect(replayTimeline.sessions.single.milestones.single.type, 'commit_created');

    final replayFrame = await client.replayFrame(5);
    expect(replayFrame.sequence, 5);
    expect(replayFrame.live, isFalse);
    expect(replayFrame.activity?.type, 'test_failed');
    expect(replayFrame.changeIntelligence?.changedEntityIds, contains('component:totem-core:api'));
    expect(replayFrame.verificationState.failedCount, 1);
    expect(replayFrame.historicalEntityIds, contains('totem-core.feature-5'));
    expect(replayFrame.milestones.single.type, 'commit_created');

    final promptSubmission = await client.submitPrompt('inspect outline api');
    expect(promptSubmission.event.type, 'prompt_submitted');
    expect(promptSubmission.execution, 'codex');
    expect(promptSubmission.task?.id, 'task:flutter-fixture:1');
    expect(promptSubmission.adapter?.busy, isTrue);
    expect(promptSubmission.adapter?.currentTask?.state, 'running');
    expect(promptSubmission.orchestration?.mode, 'bounded-parallel');
    expect(promptSubmission.orchestration?.assignments.length, 2);
    expect(promptSubmission.task?.orchestration?.score, 7);

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

    final orchestrationRequest = requests.singleWhere(
      (request) => request.url.path == '/api/orchestration-plan',
    );
    expect(
      (jsonDecode(orchestrationRequest.body) as Map<String, dynamic>)['query'],
      'inspect outline api',
    );

    final promptRequest = requests.singleWhere((request) => request.url.path == '/api/prompt');
    expect((jsonDecode(promptRequest.body) as Map<String, dynamic>)['prompt'], 'inspect outline api');

    final replayRequest = requests.singleWhere((request) => request.url.path == '/api/replay');
    expect(replayRequest.method, 'GET');

    final replayFrameRequest = requests.singleWhere((request) => request.url.path == '/api/replay/frame');
    expect(replayFrameRequest.url.queryParameters['sequence'], '5');

    final refresh = requests.singleWhere((request) => request.url.path == '/api/refresh');
    expect(refresh.method, 'POST');
    expect(
      jsonDecode(refresh.body),
      const <String, Object>{'modules': <String>['totem-core']},
    );
    client.close();
  });

  test('local client reads the private conversation transcript and publishes a debounced draft', () async {
    final requests = <http.Request>[];
    final mock = MockClient((request) async {
      requests.add(request);
      if (request.url.path == '/api/conversation') {
        return http.Response.bytes(
          utf8.encode(jsonEncode(<String, Object?>{
            'schemaVersion': 1,
            'latestRevision': 8,
            'draft': <String, Object>{
              'revision': 7,
              'timestamp': 'now',
              'clientId': 'viewer:other',
              'text': 'Discord 已送出的工作',
            },
            'entries': <Object>[
              <String, Object?>{
                'revision': 8,
                'timestamp': 'now',
                'source': 'discord',
                'kind': 'prompt',
                'text': '請同步處理工具',
                'conversationId': 'discord:123',
              },
            ],
          })),
          200,
          headers: const <String, String>{'content-type': 'application/json; charset=utf-8'},
        );
      }
      if (request.url.path == '/api/conversation/draft') {
        return http.Response(jsonEncode(<String, Object>{'status': 'accepted'}), 202);
      }
      return http.Response('not found', 404);
    });
    final client = LocalWorkspaceClient('http://127.0.0.1:18765', client: mock);

    final conversation = await client.conversation(after: 4);
    expect(conversation.latestRevision, 8);
    expect(conversation.draft?.clientId, 'viewer:other');
    expect(conversation.entries.single.source, 'discord');
    expect(conversation.entries.single.text, '請同步處理工具');

    await client.updateConversationDraft('viewer:this', '網頁未送出草稿');
    final draftRequest = requests.singleWhere((request) => request.url.path == '/api/conversation/draft');
    expect(draftRequest.method, 'POST');
    expect(
      jsonDecode(draftRequest.body),
      const <String, Object>{'clientId': 'viewer:this', 'text': '網頁未送出草稿'},
    );
    client.close();
  });
}
