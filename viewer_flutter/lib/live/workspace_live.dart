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

  if (loopback && uri.hasPort && uri.port == 8765) {
    return '${uri.scheme}://${uri.host}:${uri.port}';
  }
  return 'http://127.0.0.1:8765';
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

  Future<void> refresh({List<String> modules = const <String>[]}) async {
    final response = await _client
        .post(
          _uri('/api/refresh'),
          headers: const {'content-type': 'application/json'},
          body: jsonEncode({'modules': modules}),
        )
        .timeout(const Duration(seconds: 90));
    _requireSuccess(response, 'workspace refresh');
  }

  void close() => _client.close();

  static void _requireSuccess(http.Response response, String operation) {
    if (response.statusCode >= 200 && response.statusCode < 300) return;
    throw StateError('$operation failed: HTTP ${response.statusCode}');
  }
}
