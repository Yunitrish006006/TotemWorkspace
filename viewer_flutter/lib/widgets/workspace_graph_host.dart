import 'dart:async';

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
  bool _probing = true;
  bool _refreshing = false;
  String? _liveError;

  @override
  void initState() {
    super.initState();
    _data = widget.initialData;
    unawaited(_connectLocal());
  }

  @override
  void dispose() {
    _poller?.cancel();
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
      if (!mounted) {
        client.close();
        return;
      }
      setState(() {
        _client = client;
        _live = status;
        _probing = false;
        _liveError = null;
      });
      _poller = Timer.periodic(const Duration(seconds: 5), (_) => unawaited(_pollStatus()));
    } catch (error) {
      client.close();
      if (mounted) {
        setState(() {
          _probing = false;
          _liveError = error.toString();
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
      setState(() => _liveError = error.toString());
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
      await client.refresh();
      final results = await Future.wait<Object>([
        client.graphData(),
        client.workspaceStatus(),
      ]);
      if (!mounted) return;
      setState(() {
        _data = results[0] as GraphData;
        _live = results[1] as WorkspaceLiveStatus;
      });
    } catch (error) {
      if (mounted) setState(() => _liveError = error.toString());
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

  @override
  Widget build(BuildContext context) {
    final live = _live;
    final isLocal = _client != null && live != null;
    return Scaffold(
      backgroundColor: const Color(0xFF050B14),
      body: Column(
        children: [
          _ModeBanner(
            probing: _probing,
            local: isLocal,
            refreshing: _refreshing,
            live: live,
            error: _liveError,
            onRefresh: isLocal ? _refreshWorkspace : null,
            onStatus: isLocal ? _showWorkspaceStatus : null,
          ),
          Expanded(child: GraphView(data: _data)),
        ],
      ),
    );
  }
}

class _ModeBanner extends StatelessWidget {
  const _ModeBanner({
    required this.probing,
    required this.local,
    required this.refreshing,
    required this.live,
    required this.error,
    required this.onRefresh,
    required this.onStatus,
  });

  final bool probing;
  final bool local;
  final bool refreshing;
  final WorkspaceLiveStatus? live;
  final String? error;
  final VoidCallback? onRefresh;
  final VoidCallback? onStatus;

  @override
  Widget build(BuildContext context) {
    final label = probing
        ? 'CHECKING LOCAL WORKSPACE'
        : local
            ? 'LIVE LOCAL · ${live!.dirtyCount} dirty · ${live!.driftCount} drift · ${live!.missingCount} missing'
            : 'PUBLISHED SNAPSHOT · Flutter Phase 3';
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
              const Tooltip(
                message: 'Local API temporarily unavailable; the last graph remains usable.',
                child: Icon(Icons.warning_amber_rounded, size: 16, color: Color(0xFFFBBF24)),
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
