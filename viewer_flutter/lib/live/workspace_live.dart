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
  if (!loopback) return null;

  if (uri.hasPort && uri.port == 8765) {
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
