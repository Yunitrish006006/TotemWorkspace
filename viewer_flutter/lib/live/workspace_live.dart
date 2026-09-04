import 'dart:convert';

import 'package:http/http.dart' as http;

import '../model/graph_data.dart';

const _configuredLocalApi = String.fromEnvironment('TOTEM_LOCAL_API');

String? discoverLocalApiBase({String configured = _configuredLocalApi, Uri? pageUri}) {
  final explicit = configured.trim();
  if (explicit.isNotEmpty) return explicit.replaceFirst(RegExp(r'/$'), '');

  final uri = pageUri ?? Uri.base;
  final host = uri.host.toLowerCase();
  final loopback = host == '127.0.0.1' || host == 'localhost' || host == '::1';
  final approvedPages = host == 'yunitrish006006.github.io';
  if (!loopback && !approvedPages) return null;

  if (loopback && uri.hasPort && uri.port == 18765) {
    return '${uri.scheme}://${uri.host}:${uri.port}';
  }
  return 'http://127.0.0.1:18765';
}

class WorkspaceModuleStatus {
  const WorkspaceModuleStatus({
    required this.id,
    required this.repoName,
    required this.present,
    required this.head,
    required this.branch,
    required this.dirty,
    required this.snapshotMatch,
    required this.expectedCommit,
    required this.expectedBranch,
  });

  final String id;
  final String repoName;
  final bool present;
  final String? head;
  final String? branch;
  final bool dirty;
  final bool snapshotMatch;
  final String? expectedCommit;
  final String? expectedBranch;

  bool get drift => present && !snapshotMatch;

  factory WorkspaceModuleStatus.fromJson(Map<String, dynamic> json) => WorkspaceModuleStatus(
        id: json['id'] as String? ?? '',
        repoName: json['repoName'] as String? ?? '',
        present: json['present'] as bool? ?? false,
        head: json['head'] as String?,
        branch: json['branch'] as String?,
        dirty: json['dirty'] as bool? ?? false,
        snapshotMatch: json['snapshotMatch'] as bool? ?? false,
        expectedCommit: json['expectedCommit'] as String?,
        expectedBranch: json['expectedBranch'] as String?,
      );
}

class WorkspaceLiveStatus {
  const WorkspaceLiveStatus({
    required this.mode,
    required this.generatedAt,
    required this.snapshotDate,
    required this.modules,
  });

  final String mode;
  final String generatedAt;
  final String snapshotDate;
  final List<WorkspaceModuleStatus> modules;

  int get dirtyCount => modules.where((module) => module.dirty).length;
  int get driftCount => modules.where((module) => module.drift).length;
  int get missingCount => modules.where((module) => !module.present).length;

  WorkspaceModuleStatus? module(String id) {
    for (final module in modules) {
      if (module.id == id) return module;
    }
    return null;
  }

  factory WorkspaceLiveStatus.fromJson(Map<String, dynamic> json) {
    final snapshot = json['snapshot'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final rawModules = json['modules'] as List? ?? const <Object>[];
    return WorkspaceLiveStatus(
      mode: json['mode'] as String? ?? 'local',
      generatedAt: json['generatedAt'] as String? ?? 'unknown',
      snapshotDate: snapshot['date'] as String? ?? 'unknown',
      modules: rawModules
          .whereType<Map>()
          .map((entry) => WorkspaceModuleStatus.fromJson(Map<String, dynamic>.from(entry)))
          .toList(growable: false),
    );
  }
}

class ViewerSettings {
  const ViewerSettings({
    required this.schemaVersion,
    required this.promptEnabled,
    required this.agentActivityEnabled,
    required this.changeAnimationsEnabled,
    required this.autoExpandAgentFocus,
    required this.replayEnabled,
  });

  static const defaults = ViewerSettings(
    schemaVersion: 1,
    promptEnabled: false,
    agentActivityEnabled: true,
    changeAnimationsEnabled: true,
    autoExpandAgentFocus: true,
    replayEnabled: true,
  );

  final int schemaVersion;
  final bool promptEnabled;
  final bool agentActivityEnabled;
  final bool changeAnimationsEnabled;
  final bool autoExpandAgentFocus;
  final bool replayEnabled;

  ViewerSettings copyWith({
    bool? promptEnabled,
    bool? agentActivityEnabled,
    bool? changeAnimationsEnabled,
    bool? autoExpandAgentFocus,
    bool? replayEnabled,
  }) =>
      ViewerSettings(
        schemaVersion: schemaVersion,
        promptEnabled: promptEnabled ?? this.promptEnabled,
        agentActivityEnabled: agentActivityEnabled ?? this.agentActivityEnabled,
        changeAnimationsEnabled: changeAnimationsEnabled ?? this.changeAnimationsEnabled,
        autoExpandAgentFocus: autoExpandAgentFocus ?? this.autoExpandAgentFocus,
        replayEnabled: replayEnabled ?? this.replayEnabled,
      );

  Map<String, dynamic> toJson() => {
        'promptEnabled': promptEnabled,
        'agentActivityEnabled': agentActivityEnabled,
        'changeAnimationsEnabled': changeAnimationsEnabled,
        'autoExpandAgentFocus': autoExpandAgentFocus,
        'replayEnabled': replayEnabled,
      };

  factory ViewerSettings.fromJson(Map<String, dynamic> json) => ViewerSettings(
        schemaVersion: json['schemaVersion'] as int? ?? 1,
        promptEnabled: json['promptEnabled'] as bool? ?? false,
        agentActivityEnabled: json['agentActivityEnabled'] as bool? ?? true,
        changeAnimationsEnabled: json['changeAnimationsEnabled'] as bool? ?? true,
        autoExpandAgentFocus: json['autoExpandAgentFocus'] as bool? ?? true,
        replayEnabled: json['replayEnabled'] as bool? ?? true,
      );
}

class AgentActivityEvent {
  const AgentActivityEvent({
    required this.sequence,
    required this.timestamp,
    required this.type,
    required this.source,
    this.moduleId,
    this.featureId,
    this.componentId,
    this.file,
    this.symbol,
    this.summary,
    this.status,
    this.from,
    this.to,
    this.test,
    this.taskId,
  });

  final int sequence;
  final String timestamp;
  final String type;
  final String source;
  final String? moduleId;
  final String? featureId;
  final String? componentId;
  final String? file;
  final String? symbol;
  final String? summary;
  final String? status;
  final String? from;
  final String? to;
  final String? test;
  final String? taskId;

  String get targetLabel =>
      featureId ?? componentId ?? moduleId ?? file ?? symbol ?? test ?? '';

  factory AgentActivityEvent.fromJson(Map<String, dynamic> json) => AgentActivityEvent(
        sequence: json['sequence'] as int? ?? 0,
        timestamp: json['timestamp'] as String? ?? '',
        type: json['type'] as String? ?? 'unknown',
        source: json['source'] as String? ?? 'bridge',
        moduleId: json['moduleId'] as String?,
        featureId: json['featureId'] as String?,
        componentId: json['componentId'] as String?,
        file: json['file'] as String?,
        symbol: json['symbol'] as String?,
        summary: json['summary'] as String?,
        status: json['status'] as String?,
        from: json['from'] as String?,
        to: json['to'] as String?,
        test: json['test'] as String?,
        taskId: json['taskId'] as String?,
      );
}

class AgentActivityBatch {
  const AgentActivityBatch({
    required this.schemaVersion,
    required this.latestSequence,
    required this.events,
  });

  final int schemaVersion;
  final int latestSequence;
  final List<AgentActivityEvent> events;

  factory AgentActivityBatch.fromJson(Map<String, dynamic> json) {
    final rawEvents = json['events'] as List? ?? const <Object>[];
    return AgentActivityBatch(
      schemaVersion: json['schemaVersion'] as int? ?? 1,
      latestSequence: json['latestSequence'] as int? ?? 0,
      events: rawEvents
          .whereType<Map>()
          .map((entry) => AgentActivityEvent.fromJson(Map<String, dynamic>.from(entry)))
          .toList(growable: false),
    );
  }
}

class ChangeEntity {
  const ChangeEntity({
    required this.id,
    required this.type,
    required this.moduleId,
    required this.moduleIds,
  });

  final String id;
  final String type;
  final String? moduleId;
  final List<String> moduleIds;

  factory ChangeEntity.fromJson(Map<String, dynamic> json) => ChangeEntity(
        id: json['id'] as String? ?? '',
        type: json['type'] as String? ?? 'unknown',
        moduleId: json['moduleId'] as String?,
        moduleIds: (json['moduleIds'] as List? ?? const <Object>[])
            .whereType<String>()
            .toList(growable: false),
      );
}

class ChangeSemanticDiff {
  const ChangeSemanticDiff({
    required this.added,
    required this.modified,
    required this.removed,
    required this.changedEntityIds,
  });

  final List<ChangeEntity> added;
  final List<ChangeEntity> modified;
  final List<ChangeEntity> removed;
  final List<String> changedEntityIds;

  int get changedCount => changedEntityIds.length;

  static List<ChangeEntity> _entities(dynamic raw) => (raw as List? ?? const <Object>[])
      .whereType<Map>()
      .map((entry) => ChangeEntity.fromJson(Map<String, dynamic>.from(entry)))
      .toList(growable: false);

  factory ChangeSemanticDiff.fromJson(Map<String, dynamic> json) => ChangeSemanticDiff(
        added: _entities(json['added']),
        modified: _entities(json['modified']),
        removed: _entities(json['removed']),
        changedEntityIds: (json['changedEntityIds'] as List? ?? const <Object>[])
            .whereType<String>()
            .toList(growable: false),
      );
}

class ChangeGitFile {
  const ChangeGitFile({
    required this.moduleId,
    required this.repoName,
    required this.path,
    required this.status,
    required this.previousPath,
    required this.componentIds,
    required this.featureIds,
    required this.implementationIds,
  });

  final String moduleId;
  final String repoName;
  final String path;
  final String status;
  final String? previousPath;
  final List<String> componentIds;
  final List<String> featureIds;
  final List<String> implementationIds;

  factory ChangeGitFile.fromJson(Map<String, dynamic> json) {
    List<String> strings(String key) => (json[key] as List? ?? const <Object>[])
        .whereType<String>()
        .toList(growable: false);
    return ChangeGitFile(
      moduleId: json['moduleId'] as String? ?? '',
      repoName: json['repoName'] as String? ?? '',
      path: json['path'] as String? ?? '',
      status: json['status'] as String? ?? 'M',
      previousPath: json['previousPath'] as String?,
      componentIds: strings('componentIds'),
      featureIds: strings('featureIds'),
      implementationIds: strings('implementationIds'),
    );
  }
}

class ChangeImpact {
  const ChangeImpact({
    required this.touchedModules,
    required this.impactedModules,
    required this.contractIds,
    required this.risks,
    required this.requiresIndependentReview,
  });

  final List<String> touchedModules;
  final List<String> impactedModules;
  final List<String> contractIds;
  final List<String> risks;
  final bool requiresIndependentReview;

  factory ChangeImpact.fromJson(Map<String, dynamic> json) {
    List<String> strings(String key) => (json[key] as List? ?? const <Object>[])
        .whereType<String>()
        .toList(growable: false);
    return ChangeImpact(
      touchedModules: strings('touchedModules'),
      impactedModules: strings('impactedModules'),
      contractIds: strings('contractIds'),
      risks: strings('risks'),
      requiresIndependentReview: json['requiresIndependentReview'] as bool? ?? false,
    );
  }
}

class ChangeIntelligence {
  const ChangeIntelligence({
    required this.schemaVersion,
    required this.generatedAt,
    required this.beforeEntityCount,
    required this.afterEntityCount,
    required this.gitChanges,
    required this.semanticDiff,
    required this.affectedEntityIds,
    required this.impact,
  });

  final int schemaVersion;
  final String generatedAt;
  final int beforeEntityCount;
  final int afterEntityCount;
  final List<ChangeGitFile> gitChanges;
  final ChangeSemanticDiff semanticDiff;
  final List<String> affectedEntityIds;
  final ChangeImpact impact;

  bool get hasChanges => gitChanges.isNotEmpty || semanticDiff.changedEntityIds.isNotEmpty;
  Set<String> get changedEntityIds => affectedEntityIds.toSet();
  Set<String> get impactedModuleIds => impact.impactedModules.toSet();

  factory ChangeIntelligence.fromJson(Map<String, dynamic> json) {
    final before = Map<String, dynamic>.from(json['before'] as Map? ?? const <String, dynamic>{});
    final after = Map<String, dynamic>.from(json['after'] as Map? ?? const <String, dynamic>{});
    final rawGit = json['gitChanges'] as List? ?? const <Object>[];
    return ChangeIntelligence(
      schemaVersion: json['schemaVersion'] as int? ?? 1,
      generatedAt: json['generatedAt'] as String? ?? '',
      beforeEntityCount: before['entityCount'] as int? ?? 0,
      afterEntityCount: after['entityCount'] as int? ?? 0,
      gitChanges: rawGit
          .whereType<Map>()
          .map((entry) => ChangeGitFile.fromJson(Map<String, dynamic>.from(entry)))
          .toList(growable: false),
      semanticDiff: ChangeSemanticDiff.fromJson(
        Map<String, dynamic>.from(json['semanticDiff'] as Map? ?? const <String, dynamic>{}),
      ),
      affectedEntityIds: (json['affectedEntityIds'] as List? ?? const <Object>[])
          .whereType<String>()
          .toList(growable: false),
      impact: ChangeImpact.fromJson(
        Map<String, dynamic>.from(json['impact'] as Map? ?? const <String, dynamic>{}),
      ),
    );
  }
}

class VerificationStateEntry {
  const VerificationStateEntry({
    required this.target,
    required this.status,
    required this.sequence,
    required this.timestamp,
    required this.summary,
    required this.resolved,
    required this.testId,
    required this.moduleId,
    required this.featureIds,
    required this.componentIds,
    required this.contractIds,
    required this.capabilityIds,
  });

  final String target;
  final String status;
  final int sequence;
  final String timestamp;
  final String? summary;
  final bool resolved;
  final String? testId;
  final String? moduleId;
  final List<String> featureIds;
  final List<String> componentIds;
  final List<String> contractIds;
  final List<String> capabilityIds;

  factory VerificationStateEntry.fromJson(Map<String, dynamic> json) => VerificationStateEntry(
        target: json['target'] as String? ?? '',
        status: json['status'] as String? ?? 'unknown',
        sequence: (json['sequence'] as num?)?.toInt() ?? 0,
        timestamp: json['timestamp'] as String? ?? '',
        summary: json['summary'] as String?,
        resolved: json['resolved'] as bool? ?? false,
        testId: json['testId'] as String?,
        moduleId: json['moduleId'] as String?,
        featureIds: GraphData.strings(json['featureIds']),
        componentIds: GraphData.strings(json['componentIds']),
        contractIds: GraphData.strings(json['contractIds']),
        capabilityIds: GraphData.strings(json['capabilityIds']),
      );
}

class VerificationActivePlan {
  const VerificationActivePlan({
    required this.modules,
    required this.risks,
    required this.requiredCategories,
    required this.requirementIds,
  });

  final List<String> modules;
  final List<String> risks;
  final List<String> requiredCategories;
  final List<String> requirementIds;

  factory VerificationActivePlan.fromJson(Map<String, dynamic> json) => VerificationActivePlan(
        modules: GraphData.strings(json['modules']),
        risks: GraphData.strings(json['risks']),
        requiredCategories: GraphData.strings(json['requiredCategories']),
        requirementIds: GraphData.strings(json['requirementIds']),
      );
}

class VerificationState {
  const VerificationState({
    required this.schemaVersion,
    required this.generatedAt,
    required this.updatedAt,
    required this.entries,
    required this.runningCount,
    required this.passedCount,
    required this.failedCount,
    required this.unresolvedCount,
    required this.runningTargetIds,
    required this.passedTargetIds,
    required this.failedTargetIds,
    required this.activePlan,
  });

  final int schemaVersion;
  final String generatedAt;
  final String? updatedAt;
  final List<VerificationStateEntry> entries;
  final int runningCount;
  final int passedCount;
  final int failedCount;
  final int unresolvedCount;
  final Set<String> runningTargetIds;
  final Set<String> passedTargetIds;
  final Set<String> failedTargetIds;
  final VerificationActivePlan activePlan;

  bool get hasState => entries.isNotEmpty;
  bool get hasFailures => failedCount > 0;

  factory VerificationState.fromJson(Map<String, dynamic> json) {
    final summary = Map<String, dynamic>.from(json['summary'] as Map? ?? const <String, dynamic>{});
    return VerificationState(
      schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 1,
      generatedAt: json['generatedAt'] as String? ?? '',
      updatedAt: json['updatedAt'] as String?,
      entries: GraphData._objects(json['entries'])
          .map(VerificationStateEntry.fromJson)
          .toList(growable: false),
      runningCount: (summary['running'] as num?)?.toInt() ?? 0,
      passedCount: (summary['passed'] as num?)?.toInt() ?? 0,
      failedCount: (summary['failed'] as num?)?.toInt() ?? 0,
      unresolvedCount: (summary['unresolved'] as num?)?.toInt() ?? 0,
      runningTargetIds: GraphData.strings(json['runningTargetIds']).toSet(),
      passedTargetIds: GraphData.strings(json['passedTargetIds']).toSet(),
      failedTargetIds: GraphData.strings(json['failedTargetIds']).toSet(),
      activePlan: VerificationActivePlan.fromJson(
        Map<String, dynamic>.from(json['activePlan'] as Map? ?? const <String, dynamic>{}),
      ),
    );
  }
}

class LocalWorkspaceClient {
  LocalWorkspaceClient(this.baseUrl, {http.Client? client}) : _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;

  static LocalWorkspaceClient? discover({http.Client? client, Uri? pageUri}) {
    final base = discoverLocalApiBase(pageUri: pageUri);
    return base == null ? null : LocalWorkspaceClient(base, client: client);
  }

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Future<bool> health() async {
    final response = await _client.get(_uri('/api/health')).timeout(const Duration(seconds: 2));
    if (response.statusCode != 200) return false;
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    return payload['status'] == 'ok' && payload['mode'] == 'local';
  }

  Future<WorkspaceLiveStatus> workspaceStatus() async {
    final response = await _client.get(_uri('/api/workspace-status')).timeout(const Duration(seconds: 4));
    _requireSuccess(response, 'workspace status');
    return WorkspaceLiveStatus.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<GraphData> graphData() async {
    final response = await _client.get(_uri('/api/graph-data')).timeout(const Duration(seconds: 5));
    _requireSuccess(response, 'graph data');
    return GraphData.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ViewerSettings> viewerSettings() async {
    final response = await _client.get(_uri('/api/viewer-settings')).timeout(const Duration(seconds: 4));
    _requireSuccess(response, 'viewer settings');
    return ViewerSettings.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ViewerSettings> updateViewerSettings(ViewerSettings settings) async {
    final response = await _client
        .post(
          _uri('/api/viewer-settings'),
          headers: const {'content-type': 'application/json'},
          body: jsonEncode(settings.toJson()),
        )
        .timeout(const Duration(seconds: 4));
    _requireSuccess(response, 'viewer settings update');
    return ViewerSettings.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<AgentActivityBatch> activity({int after = 0}) async {
    final uri = _uri('/api/activity').replace(queryParameters: {'after': '$after'});
    final response = await _client.get(uri).timeout(const Duration(seconds: 4));
    _requireSuccess(response, 'agent activity');
    return AgentActivityBatch.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ChangeIntelligence> changeIntelligence() async {
    final response = await _client.get(_uri('/api/change-intelligence')).timeout(const Duration(seconds: 6));
    _requireSuccess(response, 'change intelligence');
    return ChangeIntelligence.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<VerificationState> verificationState() async {
    final response = await _client.get(_uri('/api/verification-state')).timeout(const Duration(seconds: 6));
    _requireSuccess(response, 'verification state');
    return VerificationState.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<AgentActivityEvent> submitPrompt(
    String prompt, {
    String? moduleId,
    String? featureId,
  }) async {
    final response = await _client
        .post(
          _uri('/api/prompt'),
          headers: const {'content-type': 'application/json'},
          body: jsonEncode({
            'prompt': prompt,
            if (moduleId != null) 'moduleId': moduleId,
            if (featureId != null) 'featureId': featureId,
          }),
        )
        .timeout(const Duration(seconds: 8));
    _requireSuccess(response, 'prompt submission');
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    return AgentActivityEvent.fromJson(
      Map<String, dynamic>.from(payload['event'] as Map? ?? const <String, dynamic>{}),
    );
  }

  Future<ChangeIntelligence> refresh({List<String> modules = const <String>[]}) async {
    final response = await _client
        .post(
          _uri('/api/refresh'),
          headers: const {'content-type': 'application/json'},
          body: jsonEncode({'modules': modules}),
        )
        .timeout(const Duration(seconds: 90));
    _requireSuccess(response, 'workspace refresh');
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    return ChangeIntelligence.fromJson(
      Map<String, dynamic>.from(payload['changeIntelligence'] as Map? ?? const <String, dynamic>{}),
    );
  }

  void close() => _client.close();

  static void _requireSuccess(http.Response response, String operation) {
    if (response.statusCode >= 200 && response.statusCode < 300) return;
    throw StateError('$operation failed: HTTP ${response.statusCode}');
  }
}
