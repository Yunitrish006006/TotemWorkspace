import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../live/workspace_live.dart';
import '../model/graph_data.dart';
import 'activity_location.dart';
import 'collapsible_message.dart';
import 'floating_panel.dart';
import 'graph_view.dart';

class WorkspaceGraphHost extends StatefulWidget {
  const WorkspaceGraphHost({super.key, required this.initialData});

  final GraphData initialData;

  @override
  State<WorkspaceGraphHost> createState() => _WorkspaceGraphHostState();
}

class _WorkspaceGraphHostState extends State<WorkspaceGraphHost> {
  late GraphData _data;
  LocalWorkspaceClient? _client;
  WorkspaceLiveStatus? _live;
  Timer? _poller;
  Timer? _activityPoller;
  Timer? _verificationPoller;
  Timer? _adapterPoller;
  Timer? _replayPoller;
  Timer? _conversationPoller;
  Timer? _draftDebounce;
  ViewerSettings _settings = ViewerSettings.defaults;
  ChangeIntelligence? _change;
  VerificationState? _verification;
  AgentAdapterStatus? _adapter;
  OrchestrationSummary? _orchestration;
  DevelopmentReplayTimeline? _replayTimeline;
  DevelopmentReplayFrame? _replayFrame;
  double? _replayDraftSequence;
  bool _replayLoading = false;
  final List<AgentActivityEvent> _activity = <AgentActivityEvent>[];
  int _activitySequence = 0;
  final List<DeveloperConversationEntry> _conversation =
      <DeveloperConversationEntry>[];
  final Set<String> _activePolls = <String>{};
  int _conversationRevision = 0;
  int _conversationPollFailures = 0;
  DeveloperConversationDraft? _conversationDraft;
  final String _conversationClientId =
      'viewer:${DateTime.now().microsecondsSinceEpoch}';
  bool _probing = true;
  bool _refreshing = false;
  bool _savingSettings = false;
  bool _submittingPrompt = false;
  FloatingPanelDock _workspaceDock = FloatingPanelDock.topLeft;
  FloatingPanelDock _activityDock = FloatingPanelDock.topCenter;
  FloatingPanelDock _promptDock = FloatingPanelDock.bottomLeft;
  bool _workspaceCollapsed = false;
  bool _activityCollapsed = true;
  bool _promptCollapsed = false;
  ActivitySourceLocation? _hoveredActivityLocation;
  ActivitySourceLocation? _keptOpenActivityLocation;
  String? _liveError;
  String? _liveErrorSource;

  bool get _conversationAvailable {
    final host = Uri.base.host.toLowerCase();
    return host == '127.0.0.1' || host == 'localhost' || host == '::1';
  }

  @override
  void initState() {
    super.initState();
    _data = widget.initialData;
    unawaited(_connectLocal());
  }

  @override
  void dispose() {
    _poller?.cancel();
    _activityPoller?.cancel();
    _verificationPoller?.cancel();
    _adapterPoller?.cancel();
    _replayPoller?.cancel();
    _conversationPoller?.cancel();
    _draftDebounce?.cancel();
    _client?.close();
    super.dispose();
  }

  Future<void> _connectLocal() async {
    final client = LocalWorkspaceClient.discover();
    if (client == null) {
      if (mounted) setState(() => _probing = false);
      return;
    }

    try {
      final healthy = await client.health();
      if (!healthy) {
        client.close();
        if (mounted) setState(() => _probing = false);
        return;
      }
      final status = await client.workspaceStatus();
      final settings = await client.viewerSettings();
      final results = await Future.wait<Object>([
        client.activity(),
        client.changeIntelligence(),
        client.verificationState(),
        client.agentAdapterStatus(),
        client.replayTimeline(),
      ]);
      if (!mounted) {
        client.close();
        return;
      }
      final activity = results[0] as AgentActivityBatch;
      final change = results[1] as ChangeIntelligence;
      final verification = results[2] as VerificationState;
      final adapter = results[3] as AgentAdapterStatus;
      final replayTimeline = results[4] as DevelopmentReplayTimeline;
      setState(() {
        _client = client;
        _live = status;
        _settings = settings;
        _change = change;
        _verification = verification;
        _adapter = adapter;
        _orchestration =
            adapter.currentTask?.orchestration ??
            adapter.lastTask?.orchestration;
        _replayTimeline = replayTimeline;
        _replayDraftSequence = replayTimeline.latestSequence.toDouble();
        _mergeActivity(activity);
        _probing = false;
        _liveError = null;
      });
      _poller = Timer.periodic(
        const Duration(seconds: 10),
        (_) => unawaited(_pollStatus()),
      );
      _activityPoller = Timer.periodic(
        const Duration(seconds: 2),
        (_) => unawaited(_pollActivity()),
      );
      _verificationPoller = Timer.periodic(
        const Duration(seconds: 8),
        (_) => unawaited(_pollVerification()),
      );
      _adapterPoller = Timer.periodic(
        const Duration(seconds: 3),
        (_) => unawaited(_pollAdapter()),
      );
      _replayPoller = Timer.periodic(
        const Duration(seconds: 5),
        (_) => unawaited(_pollReplayTimeline()),
      );
      _conversationPoller = _conversationAvailable
          ? Timer.periodic(
              const Duration(milliseconds: 1500),
              (_) => unawaited(_pollConversation()),
            )
          : null;
      if (_conversationAvailable) unawaited(_pollConversation());
    } catch (error) {
      client.close();
      if (mounted) {
        setState(() {
          _probing = false;
          _liveError = error.toString();
          _liveErrorSource = 'connect';
        });
      }
    }
  }

  Future<void> _pollStatus() async {
    final client = _client;
    if (client == null || _refreshing || !_activePolls.add('workspace-status'))
      return;
    try {
      final status = await client.workspaceStatus();
      if (!mounted) return;
      setState(() {
        _live = status;
        _liveError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _liveError = error.toString();
        _liveErrorSource = 'workspace-status';
      });
    } finally {
      _activePolls.remove('workspace-status');
    }
  }

  void _mergeActivity(AgentActivityBatch batch) {
    _activitySequence = batch.latestSequence;
    for (final event in batch.events) {
      if (_activity.any((existing) => existing.sequence == event.sequence))
        continue;
      _activity.add(event);
    }
    if (_activity.length > 80) {
      _activity.removeRange(0, _activity.length - 80);
    }
  }

  Future<void> _pollActivity() async {
    final client = _client;
    if (client == null ||
        !_settings.agentActivityEnabled ||
        !_activePolls.add('activity'))
      return;
    try {
      final batch = await client.activity(after: _activitySequence);
      if (!mounted || batch.events.isEmpty) return;
      GraphData? graph;
      ChangeIntelligence? change;
      if (batch.events.any((event) => event.type == 'git_diff_updated')) {
        try {
          graph = await client.graphData();
          change = await client.changeIntelligence();
        } catch (error) {
          if (mounted) {
            setState(() {
              _liveError = error.toString();
              _liveErrorSource = 'live-graph-refresh';
            });
          }
        }
      }
      if (!mounted) return;
      setState(() {
        _mergeActivity(batch);
        if (graph != null) _data = graph;
        if (change != null) _change = change;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _liveError = error.toString();
        _liveErrorSource = 'activity';
      });
    } finally {
      _activePolls.remove('activity');
    }
  }

  void _mergeConversation(DeveloperConversationBatch batch) {
    _conversationRevision = batch.latestRevision;
    _conversationDraft = batch.draft;
    for (final entry in batch.entries) {
      if (_conversation.any((existing) => existing.revision == entry.revision))
        continue;
      _conversation.add(entry);
    }
    if (_conversation.length > 80) {
      _conversation.removeRange(0, _conversation.length - 80);
    }
  }

  Future<void> _pollConversation() async {
    final client = _client;
    if (client == null ||
        !_settings.promptEnabled ||
        !_conversationAvailable ||
        !_activePolls.add('conversation'))
      return;
    try {
      final batch = await client.conversation(after: _conversationRevision);
      if (!mounted) return;
      setState(() {
        _conversationPollFailures = 0;
        _mergeConversation(batch);
        if (_liveErrorSource == 'conversation') {
          _liveError = null;
          _liveErrorSource = null;
        }
      });
    } catch (error) {
      if (!mounted) return;
      _conversationPollFailures += 1;
      if (_conversationPollFailures >= 3) {
        setState(() {
          _liveError = error.toString();
          _liveErrorSource = 'conversation';
        });
      }
    } finally {
      _activePolls.remove('conversation');
    }
  }

  void _updateConversationDraft(String text) {
    final client = _client;
    if (client == null || !_settings.promptEnabled || !_conversationAvailable)
      return;
    _draftDebounce?.cancel();
    _draftDebounce = Timer(const Duration(milliseconds: 450), () async {
      try {
        await client.updateConversationDraft(_conversationClientId, text);
      } catch (error) {
        if (!mounted) return;
        setState(() {
          _liveError = error.toString();
          _liveErrorSource = 'conversation-draft';
        });
      }
    });
  }

  Future<void> _pollVerification() async {
    final client = _client;
    if (client == null || _refreshing || !_activePolls.add('verification'))
      return;
    try {
      final verification = await client.verificationState();
      if (!mounted) return;
      setState(() {
        _verification = verification;
        _liveError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _liveError = error.toString();
        _liveErrorSource = 'verification';
      });
    } finally {
      _activePolls.remove('verification');
    }
  }

  Future<void> _pollAdapter() async {
    final client = _client;
    if (client == null || !_activePolls.add('agent-adapter')) return;
    try {
      final adapter = await client.agentAdapterStatus();
      if (!mounted) return;
      setState(() {
        _adapter = adapter;
        _orchestration =
            adapter.currentTask?.orchestration ??
            adapter.lastTask?.orchestration ??
            _orchestration;
        _liveError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _liveError = error.toString();
        _liveErrorSource = 'agent-adapter';
      });
    } finally {
      _activePolls.remove('agent-adapter');
    }
  }

  Future<void> _pollReplayTimeline() async {
    final client = _client;
    if (client == null ||
        !_settings.replayEnabled ||
        !_activePolls.add('replay'))
      return;
    try {
      final timeline = await client.replayTimeline();
      if (!mounted) return;
      setState(() {
        _replayTimeline = timeline;
        if (_replayFrame == null || _replayFrame!.live) {
          _replayDraftSequence = timeline.latestSequence.toDouble();
        }
        _liveError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _liveError = error.toString();
        _liveErrorSource = 'replay';
      });
    } finally {
      _activePolls.remove('replay');
    }
  }

  Future<void> _selectReplaySequence(int sequence) async {
    final client = _client;
    final timeline = _replayTimeline;
    if (client == null || timeline == null || _replayLoading) return;
    final clamped = sequence.clamp(
      timeline.earliestSequence,
      timeline.latestSequence,
    );
    if (clamped >= timeline.latestSequence) {
      setState(() {
        _replayFrame = null;
        _replayDraftSequence = timeline.latestSequence.toDouble();
      });
      return;
    }
    setState(() => _replayLoading = true);
    try {
      final frame = await client.replayFrame(clamped);
      if (!mounted) return;
      setState(() {
        _replayFrame = frame;
        _replayDraftSequence = frame.sequence.toDouble();
        _liveError = null;
      });
    } catch (error) {
      if (mounted)
        setState(() {
          _liveError = error.toString();
          _liveErrorSource = 'replay-frame';
        });
    } finally {
      if (mounted) setState(() => _replayLoading = false);
    }
  }

  void _goReplayLive() {
    final timeline = _replayTimeline;
    setState(() {
      _replayFrame = null;
      _replayDraftSequence = timeline?.latestSequence.toDouble();
    });
  }

  Future<void> _setPromptEnabled(bool enabled) async {
    final client = _client;
    if (client == null || _savingSettings) return;
    setState(() => _savingSettings = true);
    try {
      final next = await client.updateViewerSettings(
        _settings.copyWith(promptEnabled: enabled),
      );
      if (!mounted) return;
      setState(() {
        _settings = next;
        _liveError = null;
      });
    } catch (error) {
      if (mounted)
        setState(() {
          _liveError = error.toString();
          _liveErrorSource = 'viewer-settings';
        });
    } finally {
      if (mounted) setState(() => _savingSettings = false);
    }
  }

  Future<void> _submitPrompt(String prompt) async {
    final client = _client;
    final value = prompt.trim();
    if (client == null ||
        value.isEmpty ||
        _submittingPrompt ||
        !_settings.promptEnabled)
      return;
    setState(() => _submittingPrompt = true);
    try {
      final submission = await client.submitPrompt(
        value,
        clientId: _conversationClientId,
      );
      final event = submission.event;
      if (!mounted) return;
      setState(() {
        if (!_activity.any((existing) => existing.sequence == event.sequence)) {
          _activity.add(event);
          _activitySequence = math.max(_activitySequence, event.sequence);
        }
        if (submission.adapter != null) _adapter = submission.adapter;
        _orchestration =
            submission.orchestration?.summary ??
            submission.task?.orchestration ??
            _orchestration;
        _liveError = null;
        _liveErrorSource = null;
      });
    } catch (error) {
      if (mounted)
        setState(() {
          _liveError = error.toString();
          _liveErrorSource = 'prompt';
        });
    } finally {
      if (mounted) setState(() => _submittingPrompt = false);
    }
  }

  Future<void> _refreshWorkspace() async {
    final client = _client;
    if (client == null || _refreshing) return;
    setState(() {
      _refreshing = true;
      _liveError = null;
    });
    try {
      final change = await client.refresh();
      final results = await Future.wait<Object>([
        client.graphData(),
        client.workspaceStatus(),
        client.verificationState(),
      ]);
      if (!mounted) return;
      setState(() {
        _data = results[0] as GraphData;
        _live = results[1] as WorkspaceLiveStatus;
        _verification = results[2] as VerificationState;
        _change = change;
      });
    } catch (error) {
      if (mounted)
        setState(() {
          _liveError = error.toString();
          _liveErrorSource = 'refresh';
        });
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  Future<void> _showWorkspaceStatus() async {
    final live = _live;
    if (live == null || !mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760, maxHeight: 620),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 12, 10),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'LIVE LOCAL · Workspace status',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.all(12),
                  itemCount: live.modules.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 7),
                  itemBuilder: (context, index) {
                    final module = live.modules[index];
                    final state = !module.present
                        ? 'MISSING'
                        : module.dirty
                        ? 'DIRTY'
                        : module.drift
                        ? 'DRIFT'
                        : 'CLEAN';
                    final head = module.head == null
                        ? '—'
                        : module.head!.length > 10
                        ? module.head!.substring(0, 10)
                        : module.head!;
                    final japanese = module.japanese;
                    final japaneseState =
                        japanese == null || !japanese.applicable
                        ? 'JA n/a'
                        : japanese.complete
                        ? 'JA complete'
                        : 'JA ${japanese.translatedKeys}/${japanese.sourceKeys}';
                    final recentFiles =
                        module.recentChanges?.files ??
                        const <WorkspaceChangedFile>[];
                    return Container(
                      padding: const EdgeInsets.all(11),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0E1B2A),
                        border: Border.all(color: const Color(0xFF334B63)),
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 72,
                            child: Text(
                              state,
                              style: TextStyle(
                                fontWeight: FontWeight.w800,
                                color: state == 'CLEAN'
                                    ? const Color(0xFF86EFAC)
                                    : state == 'DIRTY'
                                    ? const Color(0xFFFBBF24)
                                    : const Color(0xFFFCA5A5),
                              ),
                            ),
                          ),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  module.repoName.isEmpty
                                      ? module.id
                                      : module.repoName,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  '${module.branch ?? 'no branch'} · $head${module.snapshotMatch ? ' · snapshot match' : ' · snapshot drift'} · $japaneseState',
                                  style: const TextStyle(
                                    color: Color(0xFF9FB4CA),
                                    fontSize: 12,
                                  ),
                                ),
                                if (recentFiles.isNotEmpty) ...[
                                  const SizedBox(height: 5),
                                  Text(
                                    'FILES · ${recentFiles.map((file) => '${file.status} ${file.path}').join(' · ')}',
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Color(0xFF67E8F9),
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showCodeInventory() async {
    if (!mounted) return;
    final inventory = _data.codeInventory;
    await showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 920, maxHeight: 720),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 12, 10),
                child: Row(
                  children: [
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'CODE-FIRST · Production source inventory',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          SizedBox(height: 3),
                          Text(
                            '程式碼區域與 surfaces 只採 production Java/Kotlin；data JSON 與 lang JSON 另列為 production resource evidence，不使用 README 或人工 feature 描述。',
                            style: TextStyle(
                              color: Color(0xFF9FB4CA),
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: inventory.modules.isEmpty
                    ? const Center(
                        child: Text('尚未建立 production code inventory'),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: inventory.modules.length,
                        itemBuilder: (context, index) => _InventoryModuleTile(
                          module: inventory.modules[index],
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final live = _live;
    final isLocal = _client != null && live != null;
    final replaying = _replayFrame != null && !_replayFrame!.live;
    final liveActivity = _activity.isEmpty ? null : _activity.last;
    final graphFocusLocation =
        _keptOpenActivityLocation ?? _hoveredActivityLocation;
    final displayedActivity = replaying ? _replayFrame!.activity : liveActivity;
    final displayedChange = replaying
        ? _replayFrame!.changeIntelligence
        : _change;
    final displayedVerification = replaying
        ? _replayFrame!.verificationState
        : _verification;
    final historicalEntityIds = replaying
        ? _replayFrame!.historicalEntityIds
        : const <String>{};
    final taskId =
        _adapter?.currentTask?.id ??
        _adapter?.lastTask?.id ??
        (_replayTimeline?.sessions.isNotEmpty == true
            ? _replayTimeline!.sessions.last.taskId
            : null);
    final showActivityPanel =
        (isLocal &&
            _settings.replayEnabled &&
            _replayTimeline?.hasEvents == true) ||
        (isLocal && _orchestration != null) ||
        (isLocal && _adapter != null) ||
        (isLocal && displayedChange?.hasChanges == true) ||
        (isLocal &&
            displayedVerification != null &&
            (displayedVerification.hasState ||
                displayedVerification.activePlan.modules.isNotEmpty)) ||
        (isLocal &&
            _settings.agentActivityEnabled &&
            displayedActivity != null);

    return Scaffold(
      backgroundColor: const Color(0xFF050B14),
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: GraphView(
                data: _data,
                activityFeatureId: graphFocusLocation?.featureId,
                activityComponentId: graphFocusLocation?.componentId,
                activityModuleId: graphFocusLocation?.moduleId,
                activityType: graphFocusLocation == null ? null : 'file_edit',
                autoExpandAgentFocus: graphFocusLocation != null,
                changedEntityIds:
                    displayedChange?.changedEntityIds ?? const <String>{},
                impactedModuleIds:
                    displayedChange?.impactedModuleIds ?? const <String>{},
                showChangeNodeIndicators: false,
                changeAnimationsEnabled: _settings.changeAnimationsEnabled,
                runningVerificationTargetIds:
                    displayedVerification?.runningTargetIds ?? const <String>{},
                passedVerificationTargetIds:
                    displayedVerification?.passedTargetIds ?? const <String>{},
                failedVerificationTargetIds:
                    displayedVerification?.failedTargetIds ?? const <String>{},
                historicalEntityIds: historicalEntityIds,
              ),
            ),
            FloatingPanel(
              title: '工作區',
              icon: Icons.hub_outlined,
              dock: _workspaceDock,
              collapsed: _workspaceCollapsed,
              onCollapsedChanged: (value) =>
                  setState(() => _workspaceCollapsed = value),
              onDockChanged: (value) => setState(() => _workspaceDock = value),
              width: 430,
              child: _ModeBanner(
                probing: _probing,
                local: isLocal,
                refreshing: _refreshing,
                savingSettings: _savingSettings,
                promptEnabled: _settings.promptEnabled,
                live: live,
                error: _liveError,
                errorSource: _liveErrorSource,
                onRefresh: isLocal ? _refreshWorkspace : null,
                onStatus: isLocal ? _showWorkspaceStatus : null,
                onInventory: _showCodeInventory,
                onPromptChanged: isLocal ? _setPromptEnabled : null,
              ),
            ),
            if (showActivityPanel)
              FloatingPanel(
                title: '開發活動',
                icon: Icons.bolt_outlined,
                dock: _activityDock,
                collapsed: _activityCollapsed,
                onCollapsedChanged: (value) =>
                    setState(() => _activityCollapsed = value),
                onDockChanged: (value) => setState(() => _activityDock = value),
                width: 520,
                expandedHeight: 272,
                child: _LiveActivityPanel(
                  replay:
                      isLocal &&
                          _settings.replayEnabled &&
                          _replayTimeline?.hasEvents == true
                      ? _ReplayScrubber(
                          timeline: _replayTimeline!,
                          sequence:
                              _replayDraftSequence ??
                              _replayTimeline!.latestSequence.toDouble(),
                          replaying: replaying,
                          loading: _replayLoading,
                          onChanged: (value) =>
                              setState(() => _replayDraftSequence = value),
                          onChangeEnd: (value) =>
                              unawaited(_selectReplaySequence(value.round())),
                          onLive: _goReplayLive,
                        )
                      : null,
                  orchestration: isLocal && _orchestration != null
                      ? _OrchestrationStrip(summary: _orchestration!)
                      : null,
                  adapter: isLocal && _adapter != null
                      ? _AgentAdapterStrip(
                          status: _adapter!,
                          replaySession:
                              _replayTimeline?.sessions.isNotEmpty == true
                              ? _replayTimeline!.sessions.last
                              : null,
                        )
                      : null,
                  change: isLocal && displayedChange?.hasChanges == true
                      ? _ChangeStrip(change: displayedChange!)
                      : null,
                  verification:
                      isLocal &&
                          displayedVerification != null &&
                          (displayedVerification.hasState ||
                              displayedVerification
                                  .activePlan
                                  .modules
                                  .isNotEmpty)
                      ? _VerificationStrip(state: displayedVerification)
                      : null,
                  activity:
                      isLocal &&
                          _settings.agentActivityEnabled &&
                          displayedActivity != null
                      ? _ActivityStrip(event: displayedActivity)
                      : null,
                ),
              ),
            if (isLocal && _settings.promptEnabled)
              FloatingPanel(
                title: taskId == null ? 'Prompt' : 'Prompt · Codex Console',
                icon: Icons.chat_outlined,
                dock: _promptDock,
                collapsed: _promptCollapsed,
                onCollapsedChanged: (value) =>
                    setState(() => _promptCollapsed = value),
                onDockChanged: (value) => setState(() => _promptDock = value),
                width: 560,
                expandedHeight: taskId == null ? 210 : 448,
                child: _PromptPanel(
                  submitting: _submittingPrompt,
                  onSubmit: _submitPrompt,
                  onDraftChanged: _updateConversationDraft,
                  locationForEvent: _activityLocationFor,
                  onLocationSelected: _showActivitySourceLocation,
                  onLocationHoverChanged: _setHoveredActivityLocation,
                  keptOpenLocation: _keptOpenActivityLocation,
                  onLocationKeepOpenChanged: _toggleKeptOpenActivityLocation,
                  events: _activity,
                  conversation: _conversation,
                  draft: _conversationDraft,
                  localDraftClientId: _conversationClientId,
                  taskId: taskId,
                ),
              ),
          ],
        ),
      ),
    );
  }

  ActivitySourceLocation? _activityLocationFor(AgentActivityEvent event) {
    final moduleId = event.moduleId?.trim();
    final moduleName = moduleId == null || moduleId.isEmpty
        ? 'TotemWorkspace'
        : _data.moduleById(moduleId)?.name ?? moduleId;
    return ActivitySourceLocation.fromEvent(event, moduleName: moduleName);
  }

  void _setHoveredActivityLocation(
    ActivitySourceLocation location,
    bool hovering,
  ) {
    final current = _hoveredActivityLocation;
    final sameLocation = location.matches(current);
    if (hovering) {
      if (sameLocation) return;
      setState(() => _hoveredActivityLocation = location);
    } else if (sameLocation) {
      setState(() => _hoveredActivityLocation = null);
    }
  }

  void _toggleKeptOpenActivityLocation(ActivitySourceLocation location) {
    setState(() {
      _keptOpenActivityLocation = location.matches(_keptOpenActivityLocation)
          ? null
          : location;
    });
  }

  void _showActivitySourceLocation(
    ActivitySourceLocation location,
    Rect anchor,
  ) {
    final overlay = Overlay.of(
      context,
      rootOverlay: true,
    ).context.findRenderObject();
    if (overlay is! RenderBox) return;
    unawaited(
      showMenu<void>(
        context: context,
        position: RelativeRect.fromRect(anchor, Offset.zero & overlay.size),
        color: const Color(0xFF0A1826),
        elevation: 16,
        constraints: const BoxConstraints(maxWidth: 460),
        items: [
          PopupMenuItem<void>(
            enabled: false,
            padding: EdgeInsets.zero,
            child: _ActivitySourceLocationPopover(location: location),
          ),
        ],
      ),
    );
  }
}

class _ActivitySourceLocationPopover extends StatelessWidget {
  const _ActivitySourceLocationPopover({required this.location});

  final ActivitySourceLocation location;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 420,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: SelectionArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.edit_note_outlined, color: Color(0xFF67E8F9)),
                  SizedBox(width: 8),
                  Text('變更位置', style: TextStyle(fontWeight: FontWeight.w800)),
                ],
              ),
              const SizedBox(height: 10),
              const Text(
                '這是目前 Prompt 執行事件的即時定位；不會另外建立已修改檔案清單。',
                style: TextStyle(fontSize: 12, height: 1.4),
              ),
              const SizedBox(height: 14),
              _SourceLocationField(label: '模組', value: location.moduleName),
              if (location.moduleId != null)
                _SourceLocationField(
                  label: 'Module ID',
                  value: location.moduleId!,
                ),
              _SourceLocationField(label: '相對路徑', value: location.file),
              for (final target in location.semanticTargets)
                _SourceLocationField(label: '語意位置', value: target),
            ],
          ),
        ),
      ),
    );
  }
}

class _SourceLocationField extends StatelessWidget {
  const _SourceLocationField({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF64748B),
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
            ),
          ),
          const SizedBox(height: 2),
          SelectableText(
            value,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 12,
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }
}

class _LiveActivityPanel extends StatelessWidget {
  const _LiveActivityPanel({
    this.replay,
    this.orchestration,
    this.adapter,
    this.change,
    this.verification,
    this.activity,
  });

  final Widget? replay;
  final Widget? orchestration;
  final Widget? adapter;
  final Widget? change;
  final Widget? verification;
  final Widget? activity;

  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.zero,
    children: [
      if (replay != null) replay!,
      if (orchestration != null) orchestration!,
      if (adapter != null) adapter!,
      if (change != null) change!,
      if (verification != null) verification!,
      if (activity != null) activity!,
    ],
  );
}

class _ReplayScrubber extends StatelessWidget {
  const _ReplayScrubber({
    required this.timeline,
    required this.sequence,
    required this.replaying,
    required this.loading,
    required this.onChanged,
    required this.onChangeEnd,
    required this.onLive,
  });

  final DevelopmentReplayTimeline timeline;
  final double sequence;
  final bool replaying;
  final bool loading;
  final ValueChanged<double> onChanged;
  final ValueChanged<double> onChangeEnd;
  final VoidCallback onLive;

  @override
  Widget build(BuildContext context) {
    final min = timeline.earliestSequence.toDouble();
    final max = math.max(timeline.latestSequence.toDouble(), min + 1);
    final value = sequence.clamp(min, max).toDouble();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: const BoxDecoration(
        color: Color(0xFF120D1B),
        border: Border(bottom: BorderSide(color: Color(0xFF4C3566))),
      ),
      child: Row(
        children: [
          Text(
            replaying ? 'REPLAY · #${value.round()}' : 'REPLAY · LIVE',
            style: TextStyle(
              color: replaying
                  ? const Color(0xFFC4B5FD)
                  : const Color(0xFF86EFAC),
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Slider(
              min: min,
              max: max,
              value: value,
              divisions: timeline.latestSequence > timeline.earliestSequence
                  ? timeline.latestSequence - timeline.earliestSequence
                  : 1,
              onChanged: loading ? null : onChanged,
              onChangeEnd: loading ? null : onChangeEnd,
            ),
          ),
          Text(
            '${timeline.eventCount} events · ${timeline.sessions.length} sessions · ${timeline.milestones.length} milestones',
            style: const TextStyle(color: Color(0xFF9FB4CA), fontSize: 10),
          ),
          const SizedBox(width: 8),
          TextButton.icon(
            onPressed: replaying && !loading ? onLive : null,
            icon: const Icon(Icons.live_tv, size: 15),
            label: const Text('LIVE'),
          ),
        ],
      ),
    );
  }
}

class _OrchestrationStrip extends StatelessWidget {
  const _OrchestrationStrip({required this.summary});

  final OrchestrationSummary summary;

  @override
  Widget build(BuildContext context) {
    final roles = summary.roles.isEmpty
        ? 'Primary only'
        : summary.roles.join(', ');
    final color = switch (summary.mode) {
      'guarded-parallel' => const Color(0xFFF0ABFC),
      'bounded-parallel' => const Color(0xFFC4B5FD),
      'assisted' => const Color(0xFF93C5FD),
      _ => const Color(0xFF94A3B8),
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: const BoxDecoration(
        color: Color(0xFF151026),
        border: Border(bottom: BorderSide(color: Color(0xFF4C3A70))),
      ),
      child: Text(
        'ORCH · ${summary.mode} · score ${summary.score} · ${summary.subagents} subagents · $roles · benefit ${summary.estimatedBenefit}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.25,
        ),
      ),
    );
  }
}

class _AgentAdapterStrip extends StatelessWidget {
  const _AgentAdapterStrip({required this.status, required this.replaySession});

  final AgentAdapterStatus status;
  final ReplaySession? replaySession;

  @override
  Widget build(BuildContext context) {
    final current = status.currentTask;
    final last = status.lastTask;
    final replay = replaySession;
    final state = status.busy && current != null
        ? 'RUNNING'
        : last != null
        ? last.state.toUpperCase()
        : replay != null
        ? replay.state == 'running'
              ? 'INTERRUPTED'
              : replay.state.toUpperCase()
        : status.available
        ? 'READY'
        : status.configured
        ? 'UNAVAILABLE'
        : 'OFF';
    final taskId = current?.id ?? last?.id ?? replay?.taskId;
    final summary = current?.summary ?? last?.summary ?? replay?.summary;
    final endedAt = last?.completedAt ?? replay?.endedAt;
    final error = last?.error;
    final color = switch (state) {
      'RUNNING' => const Color(0xFF67E8F9),
      'FAILED' => const Color(0xFFF87171),
      'INTERRUPTED' => const Color(0xFFF87171),
      'COMPLETED' => const Color(0xFF86EFAC),
      _ => const Color(0xFF94A3B8),
    };
    final detail = taskId == null ? state : '$state · $taskId';
    final tooltip = [
      if (summary != null && summary.isNotEmpty) summary,
      if (endedAt != null && endedAt.isNotEmpty) 'ended $endedAt',
      if (error != null && error.isNotEmpty) error,
      if (state == 'INTERRUPTED')
        'Replay still shows a running task, but this Bridge no longer owns an active Codex process.',
    ].join('\n');
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: const BoxDecoration(
        color: Color(0xFF0C1118),
        border: Border(bottom: BorderSide(color: Color(0xFF334155))),
      ),
      child: Tooltip(
        message: tooltip.isEmpty ? detail : tooltip,
        child: Text(
          'AGENT · $detail',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: color,
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.25,
          ),
        ),
      ),
    );
  }
}

class _ChangeStrip extends StatelessWidget {
  const _ChangeStrip({required this.change});

  final ChangeIntelligence change;

  @override
  Widget build(BuildContext context) {
    final diff = change.semanticDiff;
    final impacted = change.impact.impactedModules;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: const BoxDecoration(
        color: Color(0xFF17120A),
        border: Border(bottom: BorderSide(color: Color(0xFF5B4518))),
      ),
      child: Text(
        'CHANGE · ${change.gitChanges.length} files · +${diff.added.length} ~${diff.modified.length} −${diff.removed.length}'
        '${impacted.isEmpty ? '' : ' · impact ${impacted.join(', ')}'}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: Color(0xFFFBBF24),
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.25,
        ),
      ),
    );
  }
}

class _VerificationStrip extends StatelessWidget {
  const _VerificationStrip({required this.state});

  final VerificationState state;

  @override
  Widget build(BuildContext context) {
    final plan = state.activePlan;
    final status = state.failedCount > 0
        ? 'FAIL ${state.failedCount}'
        : state.runningCount > 0
        ? 'RUN ${state.runningCount}'
        : state.passedCount > 0
        ? 'PASS ${state.passedCount}'
        : 'READY';
    final color = state.failedCount > 0
        ? const Color(0xFFF87171)
        : state.runningCount > 0
        ? const Color(0xFF67E8F9)
        : const Color(0xFF86EFAC);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: const BoxDecoration(
        color: Color(0xFF08130F),
        border: Border(bottom: BorderSide(color: Color(0xFF28503F))),
      ),
      child: Text(
        'VERIFY · $status · ${state.passedCount} passed · ${state.failedCount} failed'
        '${plan.requiredCategories.isEmpty ? '' : ' · required ${plan.requiredCategories.length}'}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.25,
        ),
      ),
    );
  }
}

class _ActivityStrip extends StatelessWidget {
  const _ActivityStrip({required this.event});

  final AgentActivityEvent event;

  @override
  Widget build(BuildContext context) {
    final target = event.targetLabel;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: const BoxDecoration(
        color: Color(0xFF091827),
        border: Border(bottom: BorderSide(color: Color(0xFF1F3B53))),
      ),
      child: Text(
        'AGENT · ${event.type}${target.isEmpty ? '' : ' · $target'}${event.summary == null ? '' : ' · ${event.summary}'}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: Color(0xFF67E8F9),
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.25,
        ),
      ),
    );
  }
}

class _PromptPanel extends StatefulWidget {
  const _PromptPanel({
    required this.submitting,
    required this.onSubmit,
    required this.onDraftChanged,
    required this.locationForEvent,
    required this.onLocationSelected,
    required this.onLocationHoverChanged,
    required this.keptOpenLocation,
    required this.onLocationKeepOpenChanged,
    required this.events,
    required this.conversation,
    required this.draft,
    required this.localDraftClientId,
    required this.taskId,
  });

  final bool submitting;
  final ValueChanged<String> onSubmit;
  final ValueChanged<String> onDraftChanged;
  final ActivitySourceLocation? Function(AgentActivityEvent event)
  locationForEvent;
  final void Function(ActivitySourceLocation location, Rect anchor)
  onLocationSelected;
  final void Function(ActivitySourceLocation location, bool hovering)
  onLocationHoverChanged;
  final ActivitySourceLocation? keptOpenLocation;
  final ValueChanged<ActivitySourceLocation> onLocationKeepOpenChanged;
  final List<AgentActivityEvent> events;
  final List<DeveloperConversationEntry> conversation;
  final DeveloperConversationDraft? draft;
  final String localDraftClientId;
  final String? taskId;

  @override
  State<_PromptPanel> createState() => _PromptPanelState();
}

class _PromptPanelState extends State<_PromptPanel> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _consoleScroll = ScrollController();

  @override
  void didUpdateWidget(covariant _PromptPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldSequence = oldWidget.events.isEmpty
        ? 0
        : oldWidget.events.last.sequence;
    final newSequence = widget.events.isEmpty ? 0 : widget.events.last.sequence;
    if (oldSequence != newSequence) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!_consoleScroll.hasClients) return;
        _consoleScroll.animateTo(
          _consoleScroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
        );
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _consoleScroll.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _controller.text.trim();
    if (value.isEmpty || widget.submitting) return;
    widget.onSubmit(value);
    widget.onDraftChanged('');
    _controller.clear();
  }

  String _eventLabel(AgentActivityEvent event) {
    switch (event.type) {
      case 'command_started':
        return r'$';
      case 'command_completed':
        return event.status == 'failed' ? '[CMD FAIL]' : '[CMD OK]';
      case 'tool_started':
        return '[MCP →]';
      case 'tool_completed':
        return '[MCP ✓]';
      case 'file_edit':
        return '[EDIT]';
      case 'web_search_started':
        return '[WEB →]';
      case 'web_search_completed':
        return '[WEB ✓]';
      case 'todo_updated':
        return '[PLAN]';
      case 'agent_message':
        return '[CODEX]';
      case 'usage_updated':
        return '[TOKENS]';
      case 'task_started':
        return '[START]';
      case 'task_completed':
        return '[DONE]';
      case 'task_failed':
        return '[FAILED]';
      default:
        return '[${event.type}]';
    }
  }

  String _eventHeadline(AgentActivityEvent event) {
    if (event.command != null && event.command!.isNotEmpty)
      return event.command!;
    if (event.tool != null && event.tool!.isNotEmpty) return event.tool!;
    if (event.file != null && event.file!.isNotEmpty && event.summary == null)
      return event.file!;
    return event.summary ?? event.targetLabel;
  }

  @override
  Widget build(BuildContext context) {
    final taskEvents = widget.taskId == null
        ? const <AgentActivityEvent>[]
        : widget.events
              .where((event) => event.taskId == widget.taskId)
              .toList(growable: false);
    final visibleEvents = taskEvents.length > 80
        ? taskEvents.sublist(taskEvents.length - 80)
        : taskEvents;

    final remoteDraft =
        widget.draft != null &&
        widget.draft!.clientId != widget.localDraftClientId;
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxHeight < 360;
        final tiny = constraints.maxHeight < 300;
        final showRemoteDraft = remoteDraft && !tiny;
        final showConversation = widget.conversation.isNotEmpty && !tiny;
        final conversationHeight = !showConversation
            ? 0.0
            : (compact ? 72.0 : 112.0);
        final draftHeight = !showRemoteDraft ? 0.0 : (compact ? 46.0 : 64.0);
        return Container(
          decoration: const BoxDecoration(
            color: Color(0xFF07111D),
            border: Border(bottom: BorderSide(color: Color(0xFF2B4058))),
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        enabled: !widget.submitting,
                        minLines: 1,
                        maxLines: compact ? 3 : 6,
                        keyboardType: TextInputType.multiline,
                        onChanged: widget.onDraftChanged,
                        decoration: const InputDecoration(
                          isDense: true,
                          hintText:
                              '輸入 Prompt（支援多行；送出後下方會顯示 Codex CLI 等級的執行紀錄）',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      onPressed: widget.submitting ? null : _submit,
                      icon: widget.submitting
                          ? const SizedBox.square(
                              dimension: 14,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send, size: 16),
                      label: Text(widget.submitting ? '送出中' : '送出'),
                    ),
                  ],
                ),
              ),
              if (showRemoteDraft)
                SizedBox(
                  height: draftHeight,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                    color: const Color(0xFF102033),
                    child: ListView(
                      children: [
                        SelectableText(
                          'DISCORD 草稿（送出前）\n${widget.draft!.text}',
                          style: const TextStyle(
                            color: Color(0xFFBFDBFE),
                            fontSize: 11,
                            height: 1.35,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if (showConversation)
                SizedBox(
                  height: conversationHeight,
                  child: Container(
                    width: double.infinity,
                    decoration: const BoxDecoration(
                      color: Color(0xFF08131F),
                      border: Border(top: BorderSide(color: Color(0xFF1E3144))),
                    ),
                    child: ListView.builder(
                      padding: const EdgeInsets.fromLTRB(12, 7, 12, 7),
                      itemCount: widget.conversation.length,
                      itemBuilder: (context, index) {
                        final entry = widget.conversation[index];
                        final label = entry.source == 'discord'
                            ? 'DISCORD'
                            : entry.source == 'viewer'
                            ? 'WEB'
                            : 'WORKSPACE';
                        final color = entry.kind == 'prompt'
                            ? const Color(0xFFFDE68A)
                            : entry.status == 'failed'
                            ? const Color(0xFFFCA5A5)
                            : const Color(0xFFCBD5E1);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 5),
                          child: entry.kind == 'prompt'
                              ? SelectableText(
                                  '[$label] ${entry.text}',
                                  style: TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                    height: 1.3,
                                    color: color,
                                  ),
                                )
                              : CollapsibleMessage(
                                  key: ValueKey(
                                    'conversation-output:${entry.revision}',
                                  ),
                                  text: '[$label] ${entry.text}',
                                  style: TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                    height: 1.3,
                                    color: color,
                                  ),
                                ),
                        );
                      },
                    ),
                  ),
                ),
              if (widget.taskId != null)
                Expanded(
                  child: Container(
                    width: double.infinity,
                    decoration: const BoxDecoration(
                      color: Color(0xFF050A10),
                      border: Border(top: BorderSide(color: Color(0xFF1E3144))),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(12, 7, 12, 5),
                          child: Text(
                            'CODEX CONSOLE · ${widget.taskId} · ${taskEvents.length} events',
                            style: const TextStyle(
                              color: Color(0xFF9FB4CA),
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                        Expanded(
                          child: ListView.builder(
                            controller: _consoleScroll,
                            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                            itemCount: visibleEvents.length,
                            itemBuilder: (context, index) {
                              final event = visibleEvents[index];
                              final headline = _eventHeadline(event);
                              final detail = event.detail;
                              final usage = event.usage;
                              final location = widget.locationForEvent(event);
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 7),
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    if (location != null) ...[
                                      ActivitySourceLocationCard(
                                        location: location,
                                        onTap: (anchor) =>
                                            widget.onLocationSelected(
                                              location,
                                              anchor,
                                            ),
                                        onHoverChanged: (hovering) =>
                                            widget.onLocationHoverChanged(
                                              location,
                                              hovering,
                                            ),
                                        keptOpen: location.matches(
                                          widget.keptOpenLocation,
                                        ),
                                        onKeepOpenChanged: () =>
                                            widget.onLocationKeepOpenChanged(
                                              location,
                                            ),
                                      ),
                                      const SizedBox(height: 5),
                                    ],
                                    CollapsibleMessage(
                                      key: ValueKey(
                                        'console-event:${event.sequence}',
                                      ),
                                      text: [
                                        '${_eventLabel(event)} ${headline.isEmpty ? event.type : headline}',
                                        if (detail != null && detail.isNotEmpty)
                                          detail,
                                        if (usage != null)
                                          'input ${usage.inputTokens} · cached ${usage.cachedInputTokens} · output ${usage.outputTokens} · total ${usage.totalTokens}',
                                      ].join('\n'),
                                      style: TextStyle(
                                        fontFamily: 'monospace',
                                        fontSize: 11,
                                        height: 1.35,
                                        color:
                                            event.type == 'task_failed' ||
                                                event.status == 'failed'
                                            ? const Color(0xFFFCA5A5)
                                            : event.type == 'agent_message'
                                            ? const Color(0xFFD1FAE5)
                                            : const Color(0xFFCBD5E1),
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _InventoryModuleTile extends StatelessWidget {
  const _InventoryModuleTile({required this.module});

  final GraphModuleInventory module;

  String _surfaceSummary() {
    const labels = <String, String>{
      'api': 'API',
      'networking': 'NET',
      'events': 'EVENT',
      'commands': 'CMD',
      'registries': 'REG',
      'persistence': 'DATA',
      'clientUi': 'UI',
      'mixins': 'MIXIN',
      'integrations': 'INT',
    };
    return labels.entries
        .map((entry) => '${entry.value} ${module.surface(entry.key).length}')
        .join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ExpansionTile(
        title: Text(
          module.repoName.isEmpty ? module.moduleId : module.repoName,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          '${module.productionFileCount} production code files · ${module.components.length} components · ${module.resourceEvidence.fileCount} resource files\n${_surfaceSummary()}',
          style: const TextStyle(fontSize: 11, color: Color(0xFF9FB4CA)),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
        children: [
          if (module.packageRoot != null)
            _InventoryLine('Package root', module.packageRoot!),
          const _InventoryTitle('L3 Components inferred from production code'),
          if (module.components.isEmpty)
            const _InventoryLine('Components', 'No production source indexed'),
          for (final component in module.components.take(16))
            _InventoryLine(
              '${component.label} · ${component.fileCount} files · ${component.mappingConfidence}',
              [
                if (component.featureIds.isNotEmpty)
                  'Feature: ${component.featureIds.join(', ')}',
                if (component.surfaceKinds.isNotEmpty)
                  'Surfaces: ${component.surfaceKinds.join(', ')}',
                if (component.symbols.isNotEmpty)
                  component.symbols.take(8).join(', '),
                if (component.representativePaths.isNotEmpty)
                  component.representativePaths.first,
              ].join('\n'),
            ),
          if (module.resourceEvidence.families.isNotEmpty)
            const _InventoryTitle('Production resource evidence'),
          for (final family in module.resourceEvidence.families.take(16))
            _InventoryLine(
              '${family.label} · ${family.fileCount} files',
              family.representativePaths.take(6).join('\n'),
            ),
          for (final entry in const <String, String>{
            'api': 'API / contracts',
            'networking': 'Networking',
            'events': 'Events / hooks',
            'commands': 'Commands',
            'registries': 'Registries / bootstrap',
            'persistence': 'Persistence / codecs',
            'clientUi': 'Client / UI',
            'mixins': 'Mixins',
            'integrations': 'Integration-signalling code',
          }.entries) ...[
            if (module.surface(entry.key).isNotEmpty)
              _InventoryTitle(entry.value),
            for (final item in module.surface(entry.key).take(6))
              _InventoryLine(
                item.label,
                '${item.path}${item.symbols.isEmpty ? '' : '\n${item.symbols.take(8).join(', ')}'}',
              ),
          ],
          if (module.crossModuleImports.isNotEmpty)
            const _InventoryTitle('Cross-module imports'),
          for (final link in module.crossModuleImports)
            _InventoryLine(
              link.targetModuleId,
              link.evidencePaths.take(5).join('\n'),
            ),
          if (module.integrations.isNotEmpty)
            const _InventoryTitle('External package evidence'),
          for (final integration in module.integrations.take(10))
            _InventoryLine(
              integration.packageRoot,
              integration.evidencePaths.take(4).join('\n'),
            ),
        ],
      ),
    );
  }
}

class _InventoryTitle extends StatelessWidget {
  const _InventoryTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 12, bottom: 5),
    child: Align(
      alignment: Alignment.centerLeft,
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          color: Color(0xFF93C5FD),
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    ),
  );
}

class _InventoryLine extends StatelessWidget {
  const _InventoryLine(this.title, this.body);
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 5),
    padding: const EdgeInsets.all(9),
    decoration: BoxDecoration(
      color: const Color(0xFF0E1B2A),
      border: Border.all(color: const Color(0xFF334B63)),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
        ),
        if (body.isNotEmpty) ...[
          const SizedBox(height: 3),
          Text(
            body,
            style: const TextStyle(
              color: Color(0xFF9FB4CA),
              fontSize: 11,
              height: 1.35,
            ),
          ),
        ],
      ],
    ),
  );
}

class _ModeBanner extends StatelessWidget {
  const _ModeBanner({
    required this.probing,
    required this.local,
    required this.refreshing,
    required this.savingSettings,
    required this.promptEnabled,
    required this.live,
    required this.error,
    required this.errorSource,
    required this.onRefresh,
    required this.onStatus,
    required this.onInventory,
    required this.onPromptChanged,
  });

  final bool probing;
  final bool local;
  final bool refreshing;
  final bool savingSettings;
  final bool promptEnabled;
  final WorkspaceLiveStatus? live;
  final String? error;
  final String? errorSource;
  final VoidCallback? onRefresh;
  final VoidCallback? onStatus;
  final VoidCallback onInventory;
  final ValueChanged<bool>? onPromptChanged;

  @override
  Widget build(BuildContext context) {
    final label = probing
        ? 'CHECKING LOCAL WORKSPACE'
        : local
        ? 'LIVE LOCAL · ${live!.dirtyCount} dirty · ${live!.driftCount} drift · ${live!.missingCount} missing · JA ${live!.japaneseCompleteCount}/${live!.japaneseRequiredCount}'
        : 'PUBLISHED SNAPSHOT · FLUTTER ROOT';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: const BoxDecoration(
        color: Color(0xFF07111D),
        border: Border(bottom: BorderSide(color: Color(0xFF2B4058))),
      ),
      child: Wrap(
        spacing: 8,
        runSpacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.7,
              color: local ? const Color(0xFF67E8F9) : const Color(0xFF9FB4CA),
            ),
          ),
          if (error != null)
            Tooltip(
              message:
                  'Local API issue · ${errorSource ?? 'unknown'}\n$error\nThe last graph remains usable.',
              child: const Icon(
                Icons.warning_amber_rounded,
                size: 16,
                color: Color(0xFFFBBF24),
              ),
            ),
          TextButton.icon(
            onPressed: onInventory,
            icon: const Icon(Icons.account_tree_outlined, size: 16),
            label: const Text('程式碼盤點'),
          ),
          if (onPromptChanged != null)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Prompt',
                  style: TextStyle(fontSize: 11, color: Color(0xFF9FB4CA)),
                ),
                Switch.adaptive(
                  value: promptEnabled,
                  onChanged: savingSettings ? null : onPromptChanged,
                ),
              ],
            ),
          if (onStatus != null)
            TextButton.icon(
              onPressed: onStatus,
              icon: const Icon(Icons.storage, size: 16),
              label: const Text('本機狀態'),
            ),
          if (onRefresh != null)
            OutlinedButton.icon(
              onPressed: refreshing ? null : onRefresh,
              icon: refreshing
                  ? const SizedBox.square(
                      dimension: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.refresh, size: 16),
              label: Text(refreshing ? '重新索引中' : '重新整理本機'),
            ),
        ],
      ),
    );
  }
}
