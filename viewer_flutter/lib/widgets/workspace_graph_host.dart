import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../live/workspace_live.dart';
import '../model/graph_data.dart';
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
  bool _probing = true;
  bool _refreshing = false;
  bool _savingSettings = false;
  bool _submittingPrompt = false;
  String? _liveError;
  String? _liveErrorSource;

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
      final results = await Future.wait<Object>([
        client.workspaceStatus(),
        client.viewerSettings(),
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
      final status = results[0] as WorkspaceLiveStatus;
      final settings = results[1] as ViewerSettings;
      final activity = results[2] as AgentActivityBatch;
      final change = results[3] as ChangeIntelligence;
      final verification = results[4] as VerificationState;
      final adapter = results[5] as AgentAdapterStatus;
      final replayTimeline = results[6] as DevelopmentReplayTimeline;
      setState(() {
        _client = client;
        _live = status;
        _settings = settings;
        _change = change;
        _verification = verification;
        _adapter = adapter;
        _orchestration = adapter.currentTask?.orchestration ?? adapter.lastTask?.orchestration;
        _replayTimeline = replayTimeline;
        _replayDraftSequence = replayTimeline.latestSequence.toDouble();
        _mergeActivity(activity);
        _probing = false;
        _liveError = null;
      });
      _poller = Timer.periodic(const Duration(seconds: 5), (_) => unawaited(_pollStatus()));
      _activityPoller = Timer.periodic(const Duration(seconds: 1), (_) => unawaited(_pollActivity()));
      _verificationPoller =
          Timer.periodic(const Duration(seconds: 2), (_) => unawaited(_pollVerification()));
      _adapterPoller =
          Timer.periodic(const Duration(seconds: 2), (_) => unawaited(_pollAdapter()));
      _replayPoller =
          Timer.periodic(const Duration(seconds: 3), (_) => unawaited(_pollReplayTimeline()));
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
    if (client == null || _refreshing) return;
    try {
      final status = await client.workspaceStatus();
      if (!mounted) return;
      setState(() {
        _live = status;
        _liveError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() { _liveError = error.toString(); _liveErrorSource = 'workspace-status'; });
    }
  }

  void _mergeActivity(AgentActivityBatch batch) {
    _activitySequence = batch.latestSequence;
    for (final event in batch.events) {
      if (_activity.any((existing) => existing.sequence == event.sequence)) continue;
      _activity.add(event);
    }
    if (_activity.length > 80) {
      _activity.removeRange(0, _activity.length - 80);
    }
  }

  Future<void> _pollActivity() async {
    final client = _client;
    if (client == null || !_settings.agentActivityEnabled) return;
    try {
      final batch = await client.activity(after: _activitySequence);
      if (!mounted || batch.events.isEmpty) return;
      setState(() => _mergeActivity(batch));
    } catch (error) {
      if (!mounted) return;
      setState(() { _liveError = error.toString(); _liveErrorSource = 'activity'; });
    }
  }

  Future<void> _pollVerification() async {
    final client = _client;
    if (client == null || _refreshing) return;
    try {
      final verification = await client.verificationState();
      if (!mounted) return;
      setState(() {
        _verification = verification;
        _liveError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() { _liveError = error.toString(); _liveErrorSource = 'verification'; });
    }
  }

  Future<void> _pollAdapter() async {
    final client = _client;
    if (client == null) return;
    try {
      final adapter = await client.agentAdapterStatus();
      if (!mounted) return;
      setState(() {
        _adapter = adapter;
        _orchestration = adapter.currentTask?.orchestration
            ?? adapter.lastTask?.orchestration
            ?? _orchestration;
        _liveError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() { _liveError = error.toString(); _liveErrorSource = 'agent-adapter'; });
    }
  }

  Future<void> _pollReplayTimeline() async {
    final client = _client;
    if (client == null || !_settings.replayEnabled) return;
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
      setState(() { _liveError = error.toString(); _liveErrorSource = 'replay'; });
    }
  }

  Future<void> _selectReplaySequence(int sequence) async {
    final client = _client;
    final timeline = _replayTimeline;
    if (client == null || timeline == null || _replayLoading) return;
    final clamped = sequence.clamp(timeline.earliestSequence, timeline.latestSequence);
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
      if (mounted) setState(() { _liveError = error.toString(); _liveErrorSource = 'replay-frame'; });
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
      final next = await client.updateViewerSettings(_settings.copyWith(promptEnabled: enabled));
      if (!mounted) return;
      setState(() {
        _settings = next;
        _liveError = null;
      });
    } catch (error) {
      if (mounted) setState(() { _liveError = error.toString(); _liveErrorSource = 'viewer-settings'; });
    } finally {
      if (mounted) setState(() => _savingSettings = false);
    }
  }

  Future<void> _submitPrompt(String prompt) async {
    final client = _client;
    final value = prompt.trim();
    if (client == null || value.isEmpty || _submittingPrompt || !_settings.promptEnabled) return;
    setState(() => _submittingPrompt = true);
    try {
      final submission = await client.submitPrompt(value);
      final event = submission.event;
      if (!mounted) return;
      setState(() {
        if (!_activity.any((existing) => existing.sequence == event.sequence)) {
          _activity.add(event);
          _activitySequence = math.max(_activitySequence, event.sequence);
        }
        if (submission.adapter != null) _adapter = submission.adapter;
        _orchestration = submission.orchestration?.summary
            ?? submission.task?.orchestration
            ?? _orchestration;
        _liveError = null;
        _liveErrorSource = null;
      });
    } catch (error) {
      if (mounted) setState(() { _liveError = error.toString(); _liveErrorSource = 'prompt'; });
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
      if (mounted) setState(() { _liveError = error.toString(); _liveErrorSource = 'refresh'; });
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
                      child: Text('LIVE LOCAL · Workspace status',
                          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    ),
                    IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.close)),
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
                            child: Text(state,
                                style: TextStyle(
                                  fontWeight: FontWeight.w800,
                                  color: state == 'CLEAN'
                                      ? const Color(0xFF86EFAC)
                                      : state == 'DIRTY'
                                          ? const Color(0xFFFBBF24)
                                          : const Color(0xFFFCA5A5),
                                )),
                          ),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(module.repoName.isEmpty ? module.id : module.repoName,
                                    style: const TextStyle(fontWeight: FontWeight.w700)),
                                const SizedBox(height: 3),
                                Text(
                                  '${module.branch ?? 'no branch'} · $head${module.snapshotMatch ? ' · snapshot match' : ' · snapshot drift'}',
                                  style: const TextStyle(color: Color(0xFF9FB4CA), fontSize: 12),
                                ),
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
                          Text('CODE-FIRST · Production source inventory',
                              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                          SizedBox(height: 3),
                          Text('程式碼區域與 surfaces 只採 production Java/Kotlin；data JSON 與 lang JSON 另列為 production resource evidence，不使用 README 或人工 feature 描述。',
                              style: TextStyle(color: Color(0xFF9FB4CA), fontSize: 12)),
                        ],
                      ),
                    ),
                    IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.close)),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: inventory.modules.isEmpty
                    ? const Center(child: Text('尚未建立 production code inventory'))
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: inventory.modules.length,
                        itemBuilder: (context, index) => _InventoryModuleTile(module: inventory.modules[index]),
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
    AgentActivityEvent? liveSemanticActivity;
    final activeTaskId = _adapter?.currentTask?.id;
    if (activeTaskId != null) {
      for (final event in _activity.reversed) {
        if (event.taskId != activeTaskId) continue;
        final semanticTarget = event.componentId != null || event.featureId != null || event.moduleId != null;
        final semanticEdit = event.type == 'file_edit' || event.type == 'symbol_edit' || event.type == 'git_diff_updated';
        if (semanticTarget && semanticEdit) {
          liveSemanticActivity = event;
          break;
        }
      }
    }
    liveSemanticActivity ??= liveActivity;
    final displayedActivity = replaying ? _replayFrame!.activity : liveActivity;
    final displayedGraphActivity = replaying ? _replayFrame!.activity : liveSemanticActivity;
    final displayedChange = replaying ? _replayFrame!.changeIntelligence : _change;
    final displayedVerification = replaying ? _replayFrame!.verificationState : _verification;
    final historicalEntityIds = replaying ? _replayFrame!.historicalEntityIds : const <String>{};
    return Scaffold(
      backgroundColor: const Color(0xFF050B14),
      body: Column(
        children: [
          _ModeBanner(
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
          if (isLocal && _settings.replayEnabled && _replayTimeline?.hasEvents == true)
            _ReplayScrubber(
              timeline: _replayTimeline!,
              sequence: _replayDraftSequence ?? _replayTimeline!.latestSequence.toDouble(),
              replaying: replaying,
              loading: _replayLoading,
              onChanged: (value) => setState(() => _replayDraftSequence = value),
              onChangeEnd: (value) => unawaited(_selectReplaySequence(value.round())),
              onLive: _goReplayLive,
            ),
          if (isLocal && _orchestration != null)
            _OrchestrationStrip(summary: _orchestration!),
          if (isLocal && _adapter != null)
            _AgentAdapterStrip(status: _adapter!),
          if (isLocal && displayedChange?.hasChanges == true)
            _ChangeStrip(change: displayedChange!),
          if (isLocal && displayedVerification != null && (displayedVerification.hasState || displayedVerification.activePlan.modules.isNotEmpty))
            _VerificationStrip(state: displayedVerification),
          if (isLocal && _settings.agentActivityEnabled && displayedActivity != null)
            _ActivityStrip(event: displayedActivity),
          if (isLocal && _settings.promptEnabled)
            _PromptPanel(
              submitting: _submittingPrompt,
              onSubmit: _submitPrompt,
            ),
          Expanded(
            child: GraphView(
              data: _data,
              activityFeatureId: displayedGraphActivity?.featureId,
              activityComponentId: displayedGraphActivity?.componentId,
              activityModuleId: displayedGraphActivity?.moduleId,
              activityType: displayedGraphActivity?.type,
              autoExpandAgentFocus: _settings.autoExpandAgentFocus,
              changedEntityIds: displayedChange?.changedEntityIds ?? const <String>{},
              impactedModuleIds: displayedChange?.impactedModuleIds ?? const <String>{},
              changeAnimationsEnabled: _settings.changeAnimationsEnabled,
              runningVerificationTargetIds: displayedVerification?.runningTargetIds ?? const <String>{},
              passedVerificationTargetIds: displayedVerification?.passedTargetIds ?? const <String>{},
              failedVerificationTargetIds: displayedVerification?.failedTargetIds ?? const <String>{},
              historicalEntityIds: historicalEntityIds,
            ),
          ),
        ],
      ),
    );
  }
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
              color: replaying ? const Color(0xFFC4B5FD) : const Color(0xFF86EFAC),
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
    final roles = summary.roles.isEmpty ? 'Primary only' : summary.roles.join(', ');
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
  const _AgentAdapterStrip({required this.status});

  final AgentAdapterStatus status;

  @override
  Widget build(BuildContext context) {
    final task = status.currentTask ?? status.lastTask;
    final color = !status.configured || !status.available
        ? const Color(0xFF94A3B8)
        : status.busy
            ? const Color(0xFF67E8F9)
            : task?.state == 'failed'
                ? const Color(0xFFF87171)
                : const Color(0xFF86EFAC);
    final detail = status.busy
        ? (status.currentTask?.id ?? 'running')
        : status.lastTask?.state == 'failed'
            ? 'last failed'
            : status.available
                ? (status.version ?? 'ready')
                : (status.reason ?? 'disabled');
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: const BoxDecoration(
        color: Color(0xFF0C1118),
        border: Border(bottom: BorderSide(color: Color(0xFF334155))),
      ),
      child: Text(
        'AGENT ADAPTER · ${status.label} · $detail',
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
  const _PromptPanel({required this.submitting, required this.onSubmit});

  final bool submitting;
  final ValueChanged<String> onSubmit;

  @override
  State<_PromptPanel> createState() => _PromptPanelState();
}

class _PromptPanelState extends State<_PromptPanel> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _controller.text.trim();
    if (value.isEmpty || widget.submitting) return;
    widget.onSubmit(value);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        decoration: const BoxDecoration(
          color: Color(0xFF07111D),
          border: Border(bottom: BorderSide(color: Color(0xFF2B4058))),
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                enabled: !widget.submitting,
                onSubmitted: (_) => _submit(),
                decoration: const InputDecoration(
                  isDense: true,
                  hintText: '輸入 Prompt（Codex adapter READY 時會直接建立 task；OFF/UNAVAILABLE 不會假裝執行）',
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
      );
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
        title: Text(module.repoName.isEmpty ? module.moduleId : module.repoName,
            style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(
          '${module.productionFileCount} production code files · ${module.components.length} components · ${module.resourceEvidence.fileCount} resource files\n${_surfaceSummary()}',
          style: const TextStyle(fontSize: 11, color: Color(0xFF9FB4CA)),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
        children: [
          if (module.packageRoot != null) _InventoryLine('Package root', module.packageRoot!),
          const _InventoryTitle('L3 Components inferred from production code'),
          if (module.components.isEmpty) const _InventoryLine('Components', 'No production source indexed'),
          for (final component in module.components.take(16))
            _InventoryLine(
              '${component.label} · ${component.fileCount} files · ${component.mappingConfidence}',
              [
                if (component.featureIds.isNotEmpty) 'Feature: ${component.featureIds.join(', ')}',
                if (component.surfaceKinds.isNotEmpty) 'Surfaces: ${component.surfaceKinds.join(', ')}',
                if (component.symbols.isNotEmpty) component.symbols.take(8).join(', '),
                if (component.representativePaths.isNotEmpty) component.representativePaths.first,
              ].join('\n'),
            ),
          if (module.resourceEvidence.families.isNotEmpty) const _InventoryTitle('Production resource evidence'),
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
            if (module.surface(entry.key).isNotEmpty) _InventoryTitle(entry.value),
            for (final item in module.surface(entry.key).take(6))
              _InventoryLine(item.label, '${item.path}${item.symbols.isEmpty ? '' : '\n${item.symbols.take(8).join(', ')}'}'),
          ],
          if (module.crossModuleImports.isNotEmpty) const _InventoryTitle('Cross-module imports'),
          for (final link in module.crossModuleImports)
            _InventoryLine(link.targetModuleId, link.evidencePaths.take(5).join('\n')),
          if (module.integrations.isNotEmpty) const _InventoryTitle('External package evidence'),
          for (final integration in module.integrations.take(10))
            _InventoryLine(integration.packageRoot, integration.evidencePaths.take(4).join('\n')),
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
          child: Text(text.toUpperCase(),
              style: const TextStyle(color: Color(0xFF93C5FD), fontSize: 10, fontWeight: FontWeight.w800)),
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
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
            if (body.isNotEmpty) ...[
              const SizedBox(height: 3),
              Text(body, style: const TextStyle(color: Color(0xFF9FB4CA), fontSize: 11, height: 1.35)),
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
            ? 'LIVE LOCAL · ${live!.dirtyCount} dirty · ${live!.driftCount} drift · ${live!.missingCount} missing'
            : 'PUBLISHED SNAPSHOT · FLUTTER ROOT';
    return SafeArea(
      bottom: false,
      child: Container(
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
                message: 'Local API issue · ${errorSource ?? 'unknown'}\n$error\nThe last graph remains usable.',
                child: const Icon(Icons.warning_amber_rounded, size: 16, color: Color(0xFFFBBF24)),
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
                  const Text('Prompt', style: TextStyle(fontSize: 11, color: Color(0xFF9FB4CA))),
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
      ),
    );
  }
}
