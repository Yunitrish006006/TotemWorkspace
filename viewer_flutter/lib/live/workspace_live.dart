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

class WorkspaceLocaleStatus {
  const WorkspaceLocaleStatus({
    required this.applicable,
    required this.sourceFiles,
    required this.presentFiles,
    required this.validFiles,
    required this.sourceKeys,
    required this.translatedKeys,
    required this.missingKeys,
    required this.complete,
  });

  final bool applicable;
  final int sourceFiles;
  final int presentFiles;
  final int validFiles;
  final int sourceKeys;
  final int translatedKeys;
  final int missingKeys;
  final bool complete;

  factory WorkspaceLocaleStatus.fromJson(Map<String, dynamic> json) => WorkspaceLocaleStatus(
        applicable: json['applicable'] as bool? ?? false,
        sourceFiles: json['sourceFiles'] as int? ?? 0,
        presentFiles: json['presentFiles'] as int? ?? 0,
        validFiles: json['validFiles'] as int? ?? 0,
        sourceKeys: json['sourceKeys'] as int? ?? 0,
        translatedKeys: json['translatedKeys'] as int? ?? 0,
        missingKeys: json['missingKeys'] as int? ?? 0,
        complete: json['complete'] as bool? ?? false,
      );
}

class WorkspaceRecentChanges {
  const WorkspaceRecentChanges({
    required this.summary,
    required this.timestamp,
    required this.files,
  });

  final String summary;
  final String timestamp;
  final List<WorkspaceChangedFile> files;

  factory WorkspaceRecentChanges.fromJson(Map<String, dynamic> json) => WorkspaceRecentChanges(
        summary: json['summary'] as String? ?? '',
        timestamp: json['timestamp'] as String? ?? '',
        files: (json['files'] as List? ?? const <Object>[])
            .whereType<Map>()
            .map((entry) => WorkspaceChangedFile.fromJson(Map<String, dynamic>.from(entry)))
            .toList(growable: false),
      );
}

class WorkspaceChangedFile {
  const WorkspaceChangedFile({required this.status, required this.path});

  final String status;
  final String path;

  factory WorkspaceChangedFile.fromJson(Map<String, dynamic> json) => WorkspaceChangedFile(
        status: json['status'] as String? ?? 'M',
        path: json['path'] as String? ?? '',
      );
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
    required this.locales,
    required this.recentChanges,
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
  final Map<String, WorkspaceLocaleStatus> locales;
  final WorkspaceRecentChanges? recentChanges;

  bool get drift => present && !snapshotMatch;
  WorkspaceLocaleStatus? get japanese => locales['ja_jp'];

  factory WorkspaceModuleStatus.fromJson(Map<String, dynamic> json) {
    final rawLocales = json['locales'] as Map? ?? const <Object?, Object?>{};
    return WorkspaceModuleStatus(
      id: json['id'] as String? ?? '',
      repoName: json['repoName'] as String? ?? '',
      present: json['present'] as bool? ?? false,
      head: json['head'] as String?,
      branch: json['branch'] as String?,
      dirty: json['dirty'] as bool? ?? false,
      snapshotMatch: json['snapshotMatch'] as bool? ?? false,
      expectedCommit: json['expectedCommit'] as String?,
      expectedBranch: json['expectedBranch'] as String?,
      recentChanges: json['recentChanges'] is Map
          ? WorkspaceRecentChanges.fromJson(Map<String, dynamic>.from(json['recentChanges'] as Map))
          : null,
      locales: rawLocales.map(
        (key, value) => MapEntry(
          key.toString(),
          value is Map
              ? WorkspaceLocaleStatus.fromJson(Map<String, dynamic>.from(value))
              : WorkspaceLocaleStatus.fromJson(const <String, dynamic>{}),
        ),
      ),
    );
  }
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
  int get japaneseRequiredCount => modules.where((module) => module.present && module.japanese?.applicable == true).length;
  int get japaneseCompleteCount => modules.where((module) => module.present && module.japanese?.complete == true).length;

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

class CodexUsage {
  const CodexUsage({
    required this.inputTokens,
    required this.cachedInputTokens,
    required this.cacheWriteInputTokens,
    required this.outputTokens,
    required this.reasoningOutputTokens,
    required this.totalTokens,
  });

  final int inputTokens;
  final int cachedInputTokens;
  final int cacheWriteInputTokens;
  final int outputTokens;
  final int reasoningOutputTokens;
  final int totalTokens;

  factory CodexUsage.fromJson(Map<String, dynamic> json) => CodexUsage(
        inputTokens: (json['inputTokens'] as num?)?.toInt() ?? 0,
        cachedInputTokens: (json['cachedInputTokens'] as num?)?.toInt() ?? 0,
        cacheWriteInputTokens: (json['cacheWriteInputTokens'] as num?)?.toInt() ?? 0,
        outputTokens: (json['outputTokens'] as num?)?.toInt() ?? 0,
        reasoningOutputTokens: (json['reasoningOutputTokens'] as num?)?.toInt() ?? 0,
        totalTokens: (json['totalTokens'] as num?)?.toInt() ?? 0,
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
    this.detail,
    this.command,
    this.tool,
    this.usage,
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
  final String? detail;
  final String? command;
  final String? tool;
  final CodexUsage? usage;
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
        detail: json['detail'] as String?,
        command: json['command'] as String?,
        tool: json['tool'] as String?,
        usage: json['usage'] is Map
            ? CodexUsage.fromJson(Map<String, dynamic>.from(json['usage'] as Map))
            : null,
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

class DeveloperConversationDraft {
  const DeveloperConversationDraft({
    required this.revision,
    required this.timestamp,
    required this.clientId,
    required this.text,
  });

  final int revision;
  final String timestamp;
  final String clientId;
  final String text;

  factory DeveloperConversationDraft.fromJson(Map<String, dynamic> json) => DeveloperConversationDraft(
        revision: (json['revision'] as num?)?.toInt() ?? 0,
        timestamp: json['timestamp'] as String? ?? '',
        clientId: json['clientId'] as String? ?? '',
        text: json['text'] as String? ?? '',
      );
}

class DeveloperConversationEntry {
  const DeveloperConversationEntry({
    required this.revision,
    required this.timestamp,
    required this.source,
    required this.kind,
    required this.text,
    this.taskId,
    this.status,
    this.conversationId,
  });

  final int revision;
  final String timestamp;
  final String source;
  final String kind;
  final String text;
  final String? taskId;
  final String? status;
  final String? conversationId;

  factory DeveloperConversationEntry.fromJson(Map<String, dynamic> json) => DeveloperConversationEntry(
        revision: (json['revision'] as num?)?.toInt() ?? 0,
        timestamp: json['timestamp'] as String? ?? '',
        source: json['source'] as String? ?? 'workspace',
        kind: json['kind'] as String? ?? 'status',
        text: json['text'] as String? ?? '',
        taskId: json['taskId'] as String?,
        status: json['status'] as String?,
        conversationId: json['conversationId'] as String?,
      );
}

class DeveloperConversationBatch {
  const DeveloperConversationBatch({
    required this.schemaVersion,
    required this.latestRevision,
    required this.draft,
    required this.entries,
  });

  final int schemaVersion;
  final int latestRevision;
  final DeveloperConversationDraft? draft;
  final List<DeveloperConversationEntry> entries;

  factory DeveloperConversationBatch.fromJson(Map<String, dynamic> json) {
    final rawEntries = json['entries'] as List? ?? const <Object>[];
    final rawDraft = json['draft'];
    return DeveloperConversationBatch(
      schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 1,
      latestRevision: (json['latestRevision'] as num?)?.toInt() ?? 0,
      draft: rawDraft is Map
          ? DeveloperConversationDraft.fromJson(Map<String, dynamic>.from(rawDraft))
          : null,
      entries: rawEntries
          .whereType<Map>()
          .map((entry) => DeveloperConversationEntry.fromJson(Map<String, dynamic>.from(entry)))
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
      entries: (json['entries'] as List? ?? const <Object>[])
          .whereType<Map>()
          .map((entry) => VerificationStateEntry.fromJson(Map<String, dynamic>.from(entry)))
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

class OrchestrationSummary {
  const OrchestrationSummary({
    required this.mode,
    required this.score,
    required this.modules,
    required this.subagents,
    required this.roles,
    required this.maxParallelWorkers,
    required this.estimatedBenefit,
  });

  final String mode;
  final int score;
  final List<String> modules;
  final int subagents;
  final List<String> roles;
  final int maxParallelWorkers;
  final String estimatedBenefit;

  factory OrchestrationSummary.fromJson(Map<String, dynamic> json) => OrchestrationSummary(
        mode: json['mode'] as String? ?? 'primary-only',
        score: (json['score'] as num?)?.toInt() ?? 0,
        modules: GraphData.strings(json['modules']),
        subagents: (json['subagents'] as num?)?.toInt() ?? 0,
        roles: GraphData.strings(json['roles']),
        maxParallelWorkers: (json['maxParallelWorkers'] as num?)?.toInt() ?? 0,
        estimatedBenefit: json['estimatedBenefit'] as String? ?? 'none',
      );
}

class OrchestrationAssignment {
  const OrchestrationAssignment({
    required this.id,
    required this.role,
    required this.modules,
    required this.phase,
    required this.writeAllowed,
    required this.purpose,
  });

  final String id;
  final String role;
  final List<String> modules;
  final String phase;
  final bool writeAllowed;
  final String purpose;

  factory OrchestrationAssignment.fromJson(Map<String, dynamic> json) => OrchestrationAssignment(
        id: json['id'] as String? ?? '',
        role: json['role'] as String? ?? '',
        modules: GraphData.strings(json['modules']),
        phase: json['phase'] as String? ?? '',
        writeAllowed: json['writeAllowed'] as bool? ?? false,
        purpose: json['purpose'] as String? ?? '',
      );
}

class OrchestrationPlan {
  const OrchestrationPlan({
    required this.schemaVersion,
    required this.mode,
    required this.score,
    required this.modules,
    required this.assignments,
    required this.maxSubagents,
    required this.maxParallelWorkers,
    required this.estimatedBenefit,
  });

  final int schemaVersion;
  final String mode;
  final int score;
  final List<String> modules;
  final List<OrchestrationAssignment> assignments;
  final int maxSubagents;
  final int maxParallelWorkers;
  final String estimatedBenefit;

  OrchestrationSummary get summary => OrchestrationSummary(
        mode: mode,
        score: score,
        modules: modules,
        subagents: assignments.length,
        roles: assignments.map((entry) => entry.role).toList(growable: false),
        maxParallelWorkers: maxParallelWorkers,
        estimatedBenefit: estimatedBenefit,
      );

  factory OrchestrationPlan.fromJson(Map<String, dynamic> json) {
    final rationale = Map<String, dynamic>.from(
      json['rationale'] as Map? ?? const <String, dynamic>{},
    );
    final limits = Map<String, dynamic>.from(
      json['limits'] as Map? ?? const <String, dynamic>{},
    );
    return OrchestrationPlan(
      schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 1,
      mode: json['mode'] as String? ?? 'primary-only',
      score: (json['score'] as num?)?.toInt() ?? 0,
      modules: GraphData.strings(rationale['modules']),
      assignments: (json['assignments'] as List? ?? const <Object>[])
          .whereType<Map>()
          .map((entry) => OrchestrationAssignment.fromJson(Map<String, dynamic>.from(entry)))
          .toList(growable: false),
      maxSubagents: (limits['maxSubagents'] as num?)?.toInt() ?? 0,
      maxParallelWorkers: (limits['maxParallelWorkers'] as num?)?.toInt() ?? 0,
      estimatedBenefit: json['estimatedBenefit'] as String? ?? 'none',
    );
  }
}

class AgentTask {
  const AgentTask({
    required this.id,
    required this.adapter,
    required this.state,
    required this.moduleId,
    required this.featureId,
    required this.threadId,
    required this.startedAt,
    required this.completedAt,
    required this.summary,
    required this.error,
    required this.orchestration,
  });

  final String id;
  final String adapter;
  final String state;
  final String? moduleId;
  final String? featureId;
  final String? threadId;
  final String startedAt;
  final String? completedAt;
  final String? summary;
  final String? error;
  final OrchestrationSummary? orchestration;

  factory AgentTask.fromJson(Map<String, dynamic> json) => AgentTask(
        id: json['id'] as String? ?? '',
        adapter: json['adapter'] as String? ?? '',
        state: json['state'] as String? ?? 'unknown',
        moduleId: json['moduleId'] as String?,
        featureId: json['featureId'] as String?,
        threadId: json['threadId'] as String?,
        startedAt: json['startedAt'] as String? ?? '',
        completedAt: json['completedAt'] as String?,
        summary: json['summary'] as String?,
        error: json['error'] as String?,
        orchestration: json['orchestration'] is Map
            ? OrchestrationSummary.fromJson(
                Map<String, dynamic>.from(json['orchestration'] as Map),
              )
            : null,
      );
}

class AgentAdapterStatus {
  const AgentAdapterStatus({
    required this.schemaVersion,
    required this.kind,
    required this.configured,
    required this.available,
    required this.busy,
    required this.version,
    required this.sandbox,
    required this.model,
    required this.reason,
    required this.currentTask,
    required this.lastTask,
  });

  final int schemaVersion;
  final String kind;
  final bool configured;
  final bool available;
  final bool busy;
  final String? version;
  final String? sandbox;
  final String? model;
  final String? reason;
  final AgentTask? currentTask;
  final AgentTask? lastTask;

  String get label {
    if (!configured) return 'ADAPTER OFF';
    if (!available) return 'CODEX UNAVAILABLE';
    if (busy) return 'CODEX BUSY';
    return 'CODEX READY';
  }

  factory AgentAdapterStatus.fromJson(Map<String, dynamic> json) {
    AgentTask? task(String key) {
      final raw = json[key];
      return raw is Map ? AgentTask.fromJson(Map<String, dynamic>.from(raw)) : null;
    }

    return AgentAdapterStatus(
      schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 1,
      kind: json['kind'] as String? ?? 'off',
      configured: json['configured'] as bool? ?? false,
      available: json['available'] as bool? ?? false,
      busy: json['busy'] as bool? ?? false,
      version: json['version'] as String?,
      sandbox: json['sandbox'] as String?,
      model: json['model'] as String?,
      reason: json['reason'] as String?,
      currentTask: task('currentTask'),
      lastTask: task('lastTask'),
    );
  }
}

class PromptSubmission {
  const PromptSubmission({
    required this.status,
    required this.execution,
    required this.event,
    required this.task,
    required this.adapter,
    required this.orchestration,
  });

  final String status;
  final String execution;
  final AgentActivityEvent event;
  final AgentTask? task;
  final AgentAdapterStatus? adapter;
  final OrchestrationPlan? orchestration;

  factory PromptSubmission.fromJson(Map<String, dynamic> json) {
    final rawTask = json['task'];
    final rawAdapter = json['adapter'];
    final rawOrchestration = json['orchestration'];
    return PromptSubmission(
      status: json['status'] as String? ?? 'accepted',
      execution: json['execution'] as String? ?? 'unknown',
      event: AgentActivityEvent.fromJson(
        Map<String, dynamic>.from(json['event'] as Map? ?? const <String, dynamic>{}),
      ),
      task: rawTask is Map ? AgentTask.fromJson(Map<String, dynamic>.from(rawTask)) : null,
      adapter: rawAdapter is Map
          ? AgentAdapterStatus.fromJson(Map<String, dynamic>.from(rawAdapter))
          : null,
      orchestration: rawOrchestration is Map
          ? OrchestrationPlan.fromJson(Map<String, dynamic>.from(rawOrchestration))
          : null,
    );
  }
}

class ReplayMilestone {
  const ReplayMilestone({
    required this.sequence,
    required this.timestamp,
    required this.type,
    required this.taskId,
    required this.sessionId,
    required this.moduleId,
    required this.summary,
  });

  final int sequence;
  final String timestamp;
  final String type;
  final String? taskId;
  final String? sessionId;
  final String? moduleId;
  final String? summary;

  factory ReplayMilestone.fromJson(Map<String, dynamic> json) => ReplayMilestone(
        sequence: (json['sequence'] as num?)?.toInt() ?? 0,
        timestamp: json['timestamp'] as String? ?? '',
        type: json['type'] as String? ?? 'unknown',
        taskId: json['taskId'] as String?,
        sessionId: json['sessionId'] as String?,
        moduleId: json['moduleId'] as String?,
        summary: json['summary'] as String?,
      );
}

class ReplaySession {
  const ReplaySession({
    required this.id,
    required this.taskId,
    required this.state,
    required this.startedSequence,
    required this.endedSequence,
    required this.startedAt,
    required this.endedAt,
    required this.moduleId,
    required this.featureId,
    required this.summary,
    required this.eventCount,
    required this.milestoneCount,
    required this.milestones,
  });

  final String id;
  final String? taskId;
  final String state;
  final int startedSequence;
  final int? endedSequence;
  final String startedAt;
  final String? endedAt;
  final String? moduleId;
  final String? featureId;
  final String? summary;
  final int eventCount;
  final int milestoneCount;
  final List<ReplayMilestone> milestones;

  factory ReplaySession.fromJson(Map<String, dynamic> json) => ReplaySession(
        id: json['id'] as String? ?? '',
        taskId: json['taskId'] as String?,
        state: json['state'] as String? ?? 'unknown',
        startedSequence: (json['startedSequence'] as num?)?.toInt() ?? 0,
        endedSequence: (json['endedSequence'] as num?)?.toInt(),
        startedAt: json['startedAt'] as String? ?? '',
        endedAt: json['endedAt'] as String?,
        moduleId: json['moduleId'] as String?,
        featureId: json['featureId'] as String?,
        summary: json['summary'] as String?,
        eventCount: (json['eventCount'] as num?)?.toInt() ?? 0,
        milestoneCount: (json['milestoneCount'] as num?)?.toInt() ?? 0,
        milestones: (json['milestones'] as List? ?? const <Object>[])
            .whereType<Map>()
            .map((entry) => ReplayMilestone.fromJson(Map<String, dynamic>.from(entry)))
            .toList(growable: false),
      );
}

class DevelopmentReplayTimeline {
  const DevelopmentReplayTimeline({
    required this.schemaVersion,
    required this.generatedAt,
    required this.updatedAt,
    required this.earliestSequence,
    required this.latestSequence,
    required this.eventCount,
    required this.sessions,
    required this.milestones,
  });

  final int schemaVersion;
  final String generatedAt;
  final String? updatedAt;
  final int earliestSequence;
  final int latestSequence;
  final int eventCount;
  final List<ReplaySession> sessions;
  final List<ReplayMilestone> milestones;

  bool get hasEvents => eventCount > 0 && latestSequence >= earliestSequence;

  factory DevelopmentReplayTimeline.fromJson(Map<String, dynamic> json) => DevelopmentReplayTimeline(
        schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 1,
        generatedAt: json['generatedAt'] as String? ?? '',
        updatedAt: json['updatedAt'] as String?,
        earliestSequence: (json['earliestSequence'] as num?)?.toInt() ?? 0,
        latestSequence: (json['latestSequence'] as num?)?.toInt() ?? 0,
        eventCount: (json['eventCount'] as num?)?.toInt() ?? 0,
        sessions: (json['sessions'] as List? ?? const <Object>[])
            .whereType<Map>()
            .map((entry) => ReplaySession.fromJson(Map<String, dynamic>.from(entry)))
            .toList(growable: false),
        milestones: (json['milestones'] as List? ?? const <Object>[])
            .whereType<Map>()
            .map((entry) => ReplayMilestone.fromJson(Map<String, dynamic>.from(entry)))
            .toList(growable: false),
      );
}

class DevelopmentReplayFrame {
  const DevelopmentReplayFrame({
    required this.schemaVersion,
    required this.sequence,
    required this.latestSequence,
    required this.live,
    required this.activity,
    required this.changeIntelligence,
    required this.verificationState,
    required this.historicalEntityIds,
    required this.milestones,
  });

  final int schemaVersion;
  final int sequence;
  final int latestSequence;
  final bool live;
  final AgentActivityEvent? activity;
  final ChangeIntelligence? changeIntelligence;
  final VerificationState verificationState;
  final Set<String> historicalEntityIds;
  final List<ReplayMilestone> milestones;

  factory DevelopmentReplayFrame.fromJson(Map<String, dynamic> json) {
    final activityRaw = json['activity'];
    final changeRaw = json['changeIntelligence'];
    final graphState = Map<String, dynamic>.from(
      json['graphState'] as Map? ?? const <String, dynamic>{},
    );
    return DevelopmentReplayFrame(
      schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 1,
      sequence: (json['sequence'] as num?)?.toInt() ?? 0,
      latestSequence: (json['latestSequence'] as num?)?.toInt() ?? 0,
      live: json['live'] as bool? ?? false,
      activity: activityRaw is Map
          ? AgentActivityEvent.fromJson(Map<String, dynamic>.from(activityRaw))
          : null,
      changeIntelligence: changeRaw is Map
          ? ChangeIntelligence.fromJson(Map<String, dynamic>.from(changeRaw))
          : null,
      verificationState: VerificationState.fromJson(
        Map<String, dynamic>.from(
          json['verificationState'] as Map? ?? const <String, dynamic>{},
        ),
      ),
      historicalEntityIds: GraphData.strings(graphState['entityIds']).toSet(),
      milestones: (json['milestones'] as List? ?? const <Object>[])
          .whereType<Map>()
          .map((entry) => ReplayMilestone.fromJson(Map<String, dynamic>.from(entry)))
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
    final response = await _client.get(_uri('/api/health')).timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) return false;
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    return payload['status'] == 'ok' && payload['mode'] == 'local';
  }

  Future<WorkspaceLiveStatus> workspaceStatus() async {
    final response = await _client.get(_uri('/api/workspace-status')).timeout(const Duration(seconds: 12));
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
    final response = await _client.get(uri).timeout(const Duration(seconds: 8));
    _requireSuccess(response, 'agent activity');
    return AgentActivityBatch.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<DeveloperConversationBatch> conversation({int after = 0}) async {
    final uri = _uri('/api/conversation').replace(queryParameters: {'after': '$after'});
    final response = await _client.get(uri).timeout(const Duration(seconds: 8));
    _requireSuccess(response, 'developer conversation');
    return DeveloperConversationBatch.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> updateConversationDraft(String clientId, String text) async {
    final response = await _client
        .post(
          _uri('/api/conversation/draft'),
          headers: const {'content-type': 'application/json'},
          body: jsonEncode({'clientId': clientId, 'text': text}),
        )
        .timeout(const Duration(seconds: 8));
    _requireSuccess(response, 'developer conversation draft');
  }

  Future<AgentAdapterStatus> agentAdapterStatus() async {
    final response = await _client.get(_uri('/api/agent-adapter')).timeout(const Duration(seconds: 8));
    _requireSuccess(response, 'agent adapter status');
    return AgentAdapterStatus.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<OrchestrationPlan> orchestrationPlan(
    String query, {
    String? moduleId,
    String? featureId,
  }) async {
    final response = await _client
        .post(
          _uri('/api/orchestration-plan'),
          headers: const {'content-type': 'application/json'},
          body: jsonEncode({
            'query': query,
            if (moduleId != null) 'moduleId': moduleId,
            if (featureId != null) 'featureId': featureId,
          }),
        )
        .timeout(const Duration(seconds: 6));
    _requireSuccess(response, 'orchestration plan');
    return OrchestrationPlan.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<DevelopmentReplayTimeline> replayTimeline() async {
    final response = await _client.get(_uri('/api/replay')).timeout(const Duration(seconds: 5));
    _requireSuccess(response, 'development replay timeline');
    return DevelopmentReplayTimeline.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<DevelopmentReplayFrame> replayFrame(int sequence) async {
    final uri = _uri('/api/replay/frame').replace(queryParameters: {'sequence': '$sequence'});
    final response = await _client.get(uri).timeout(const Duration(seconds: 6));
    _requireSuccess(response, 'development replay frame');
    return DevelopmentReplayFrame.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
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

  Future<PromptSubmission> submitPrompt(
    String prompt, {
    String? moduleId,
    String? featureId,
    String? clientId,
  }) async {
    final response = await _client
        .post(
          _uri('/api/prompt'),
          headers: const {'content-type': 'application/json'},
          body: jsonEncode({
            'prompt': prompt,
            if (moduleId != null) 'moduleId': moduleId,
            if (featureId != null) 'featureId': featureId,
            if (clientId != null) 'clientId': clientId,
          }),
        )
        .timeout(const Duration(seconds: 8));
    _requireSuccess(response, 'prompt submission');
    return PromptSubmission.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
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
