import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../model/graph_data.dart';
import '../model/graph_scene.dart';

class GraphView extends StatefulWidget {
  const GraphView({super.key, required this.data});

  final GraphData data;

  @override
  State<GraphView> createState() => _GraphViewState();
}

class _GraphViewState extends State<GraphView> {
  Camera3d _camera = const Camera3d();
  String? _selectedId = 'totem-core';
  final Set<String> _expanded = <String>{};
  final Set<String> _enabledFilters = edgeFilterKeys.toSet();
  double _gestureStartZoom = 1;
  Offset? _lastFocalPoint;

  GraphScene get _scene => buildGraphScene(
        widget.data,
        expanded: _expanded,
        enabledFilters: _enabledFilters,
      );

  @override
  Widget build(BuildContext context) {
    final scene = _scene;
    final selected = scene.byId[_selectedId];
    final relationships = selected == null
        ? const <VisualEdge>[]
        : scene.edges
            .where((edge) => edge.from == selected.id || edge.to == selected.id)
            .toList(growable: false);
    final infoPanel = selected == null
        ? null
        : _InfoPanel(
            node: selected,
            relationships: relationships,
            expanded: _expanded.contains(selected.id),
          );

    return Scaffold(
      backgroundColor: const Color(0xFF050B14),
      body: SafeArea(
        child: Column(
          children: [
            _Toolbar(
              data: widget.data,
              expandedCount: _expanded.length,
              enabledFilters: _enabledFilters,
              onReset: _resetView,
              onToggleAll: _toggleAll,
              onFilterSelected: _handleFilterSelection,
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final desktop = constraints.maxWidth >= 900;
                  if (desktop) {
                    return Row(
                      children: [
                        Expanded(child: _buildCanvas(scene)),
                        if (infoPanel != null) SizedBox(width: 360, child: infoPanel),
                      ],
                    );
                  }
                  return Stack(
                    children: [
                      Positioned.fill(child: _buildCanvas(scene)),
                      if (infoPanel != null)
                        Align(
                          alignment: Alignment.bottomCenter,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxHeight: 260),
                            child: infoPanel,
                          ),
                        ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCanvas(GraphScene scene) => LayoutBuilder(
        builder: (context, constraints) {
          final size = Size(constraints.maxWidth, constraints.maxHeight);
          return Focus(
            autofocus: true,
            onKeyEvent: (_, event) => _handleKey(scene, event),
            child: Listener(
              onPointerSignal: (event) {
                if (event is PointerScrollEvent) {
                  final factor = math.exp(-event.scrollDelta.dy * 0.001);
                  setState(() {
                    _camera = _camera.copyWith(
                      zoom: (_camera.zoom * factor).clamp(0.32, 3.2).toDouble(),
                    );
                  });
                }
              },
              onPointerMove: (event) {
                if ((event.buttons & kSecondaryMouseButton) == 0) return;
                setState(() {
                  _camera = _camera.copyWith(
                    panX: _camera.panX + event.delta.dx,
                    panY: _camera.panY + event.delta.dy,
                  );
                });
              },
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onScaleStart: (details) {
                  _gestureStartZoom = _camera.zoom;
                  _lastFocalPoint = details.localFocalPoint;
                },
                onScaleUpdate: (details) {
                  final previous = _lastFocalPoint ?? details.localFocalPoint;
                  final delta = details.localFocalPoint - previous;
                  _lastFocalPoint = details.localFocalPoint;
                  if (details.pointerCount >= 2) {
                    setState(() {
                      _camera = _camera.copyWith(
                        zoom: (_gestureStartZoom * details.scale).clamp(0.32, 3.2).toDouble(),
                        panX: _camera.panX + delta.dx,
                        panY: _camera.panY + delta.dy,
                      );
                    });
                  } else {
                    setState(() {
                      _camera = _camera.copyWith(
                        yaw: _camera.yaw + delta.dx * 0.008,
                        pitch: (_camera.pitch + delta.dy * 0.006).clamp(-1.2, 1.2).toDouble(),
                      );
                    });
                  }
                },
                onScaleEnd: (_) => _lastFocalPoint = null,
                onTapUp: (details) {
                  final id = _hitTest(scene, details.localPosition, size);
                  if (id == null) {
                    setState(() => _selectedId = null);
                    return;
                  }
                  _activate(scene, id, toggleModule: true);
                },
                child: CustomPaint(
                  size: Size.infinite,
                  painter: _GraphPainter(
                    data: widget.data,
                    scene: scene,
                    camera: _camera,
                    selectedId: _selectedId,
                  ),
                ),
              ),
            ),
          );
        },
      );

  void _resetView() {
    setState(() {
      _camera = const Camera3d();
      _selectedId = 'totem-core';
    });
  }

  void _toggleAll() {
    setState(() {
      if (_expanded.length == widget.data.modules.length) {
        _expanded.clear();
      } else {
        _expanded
          ..clear()
          ..addAll(widget.data.modules.map((module) => module.id));
      }
    });
  }

  void _handleFilterSelection(String value) {
    setState(() {
      if (value == '__all') {
        _enabledFilters
          ..clear()
          ..addAll(edgeFilterKeys);
      } else if (value == '__none') {
        _enabledFilters.clear();
      } else if (_enabledFilters.contains(value)) {
        _enabledFilters.remove(value);
      } else {
        _enabledFilters.add(value);
      }
    });
  }

  KeyEventResult _handleKey(GraphScene scene, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    final nodes = scene.nodes;
    if (nodes.isEmpty) return KeyEventResult.ignored;

    if (event.logicalKey == LogicalKeyboardKey.home) {
      setState(() => _selectedId = 'totem-core');
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.end) {
      setState(() => _selectedId = nodes.last.id);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      setState(() => _selectedId = null);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter || event.logicalKey == LogicalKeyboardKey.space) {
      final id = _selectedId;
      if (id != null) _activate(scene, id, toggleModule: true);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowRight ||
        event.logicalKey == LogicalKeyboardKey.arrowDown ||
        event.logicalKey == LogicalKeyboardKey.arrowLeft ||
        event.logicalKey == LogicalKeyboardKey.arrowUp) {
      final currentIndex = nodes.indexWhere((node) => node.id == _selectedId);
      final forward = event.logicalKey == LogicalKeyboardKey.arrowRight ||
          event.logicalKey == LogicalKeyboardKey.arrowDown;
      final next = currentIndex < 0
          ? 0
          : (currentIndex + (forward ? 1 : -1) + nodes.length) % nodes.length;
      setState(() => _selectedId = nodes[next].id);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  void _activate(GraphScene scene, String id, {required bool toggleModule}) {
    final node = scene.byId[id];
    if (node == null) return;
    setState(() {
      _selectedId = id;
      if (toggleModule && node.kind == 'module') {
        if (_expanded.contains(id)) {
          _expanded.remove(id);
        } else {
          _expanded.add(id);
        }
      }
    });
  }

  String? _hitTest(GraphScene scene, Offset point, Size size) {
    String? best;
    var bestDistance = double.infinity;
    for (final node in scene.nodes) {
      final projected = _camera.project(node.position, size);
      final threshold = node.isChild ? 24.0 : 30.0;
      final distance = (projected.offset - point).distance;
      if (distance < threshold && distance < bestDistance) {
        best = node.id;
        bestDistance = distance;
      }
    }
    return best;
  }
}

class _Toolbar extends StatelessWidget {
  const _Toolbar({
    required this.data,
    required this.expandedCount,
    required this.enabledFilters,
    required this.onReset,
    required this.onToggleAll,
    required this.onFilterSelected,
  });

  final GraphData data;
  final int expandedCount;
  final Set<String> enabledFilters;
  final VoidCallback onReset;
  final VoidCallback onToggleAll;
  final ValueChanged<String> onFilterSelected;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: const BoxDecoration(
          color: Color(0xEE06101B),
          border: Border(bottom: BorderSide(color: Color(0xFF26394F))),
        ),
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            const SizedBox(
              width: 300,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('TOTEM Architecture · Flutter Phase 3',
                      style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                  Text('feature clusters · relation-aware endpoints · shared graph model',
                      style: TextStyle(color: Color(0xFF8FA5BD), fontSize: 11)),
                ],
              ),
            ),
            _Pill('${data.modules.length} modules'),
            _Pill('${data.features.length} features'),
            _Pill('${data.contracts.length} contracts'),
            _Pill('${data.sharedCapabilities.length} shared'),
            PopupMenuButton<String>(
              tooltip: '線條種類',
              onSelected: onFilterSelected,
              itemBuilder: (context) => [
                const PopupMenuItem(value: '__all', child: Text('全部線條')),
                const PopupMenuItem(value: '__none', child: Text('清除線條')),
                const PopupMenuDivider(),
                for (final key in edgeFilterKeys)
                  CheckedPopupMenuItem(
                    value: key,
                    checked: enabledFilters.contains(key),
                    child: Text(edgeFilterLabels[key] ?? key),
                  ),
              ],
              child: _Pill('線條 ${enabledFilters.length}/${edgeFilterKeys.length}'),
            ),
            OutlinedButton(
              onPressed: onToggleAll,
              child: Text(expandedCount == data.modules.length ? '全部收合' : '全展開'),
            ),
            OutlinedButton(onPressed: onReset, child: const Text('總覽 / 重設視角')),
          ],
        ),
      );
}

class _Pill extends StatelessWidget {
  const _Pill(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: const Color(0xFF0C1D2D),
          border: Border.all(color: const Color(0xFF38506A)),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(text, style: const TextStyle(color: Color(0xFFBDD0E5), fontSize: 11)),
      );
}

class _InfoPanel extends StatelessWidget {
  const _InfoPanel({required this.node, required this.relationships, required this.expanded});

  final VisualNode node;
  final List<VisualEdge> relationships;
  final bool expanded;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: Color(0xF2071522),
        border: Border(left: BorderSide(color: Color(0xFF2D435C)), top: BorderSide(color: Color(0xFF2D435C))),
      ),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(node.label, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
          if (node.module case final module?) ...[
            const SizedBox(height: 6),
            Text(module.role, style: const TextStyle(color: Color(0xFFB8C9DA), height: 1.5)),
            const SizedBox(height: 8),
            _Item(expanded ? 'Expanded cluster' : 'Collapsed module'),
            const SizedBox(height: 8),
            const _SectionTitle('Feature groups'),
            for (final group in module.featureGroups) _Item(group),
          ],
          if (node.feature case final feature?) ...[
            const SizedBox(height: 8),
            Text(feature.summary, style: const TextStyle(color: Color(0xFFB8C9DA), height: 1.5)),
            const SizedBox(height: 8),
            _Item('Owner: ${feature.ownerId}'),
          ],
          if (node.capability case final capability?) ...[
            const SizedBox(height: 8),
            _Item(capability.label),
            _Item('${capability.consumerModuleId} → ${capability.providerModuleId}'),
          ],
          const SizedBox(height: 14),
          const _SectionTitle('Visible relationships'),
          if (relationships.isEmpty) const _Item('No visible relationship under current filters'),
          for (final edge in relationships) _Item('${edge.type} · ${edge.from} → ${edge.to}\n${edge.label}'),
          const SizedBox(height: 20),
          const Text(
            '點模組展開/收合 · 左鍵/一指旋轉 · 右鍵拖曳平移 · 兩指縮放＋平移 · 滾輪縮放 · 方向鍵選節點 · Enter/Space 啟動 · Home 回 Core · Esc 清除',
            style: TextStyle(color: Color(0xFF8FA5BD), fontSize: 11, height: 1.45),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text.toUpperCase(),
            style: const TextStyle(
              color: Color(0xFF93C5FD),
              fontSize: 11,
              letterSpacing: 1.1,
              fontWeight: FontWeight.w700,
            )),
      );
}

class _Item extends StatelessWidget {
  const _Item(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 7),
        padding: const EdgeInsets.all(9),
        decoration: BoxDecoration(
          color: const Color(0xFF102033),
          border: Border.all(color: const Color(0xFF334B63)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(text, style: const TextStyle(color: Color(0xFFD7E5F4), fontSize: 12, height: 1.4)),
      );
}

class _GraphPainter extends CustomPainter {
  const _GraphPainter({
    required this.data,
    required this.scene,
    required this.camera,
    required this.selectedId,
  });

  final GraphData data;
  final GraphScene scene;
  final Camera3d camera;
  final String? selectedId;

  @override
  void paint(Canvas canvas, Size size) {
    final background = Paint()
      ..shader = const RadialGradient(
        center: Alignment(-0.18, -0.68),
        radius: 1.15,
        colors: [Color(0xFF12304C), Color(0xFF081522), Color(0xFF050B14)],
      ).createShader(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, background);

    final byId = scene.byId;
    final projected = {for (final node in scene.nodes) node.id: camera.project(node.position, size)};
    final selected = byId[selectedId];
    final spotlightId = selected?.isChild == true ? selectedId : null;
    final connected = <String>{};
    final relatedOwners = <String>{};
    if (spotlightId != null) {
      connected.add(spotlightId);
      for (final edge in scene.edges) {
        if (edge.from != spotlightId && edge.to != spotlightId) continue;
        final other = edge.from == spotlightId ? edge.to : edge.from;
        connected.add(other);
        final owner = scene.ownerOf(other);
        if (owner != null) relatedOwners.add(owner);
      }
    }

    for (final cluster in scene.clusters) {
      final parent = projected[cluster.ownerId];
      if (parent == null) continue;
      final active = scene.ownerOf(spotlightId ?? '') == cluster.ownerId;
      final related = relatedOwners.contains(cluster.ownerId);
      _drawCluster(canvas, cluster, parent, active: active, related: related, dim: spotlightId != null && !active && !related);
    }

    for (final edge in scene.edges) {
      final from = projected[edge.from];
      final to = projected[edge.to];
      if (from == null || to == null) continue;
      final incident = spotlightId == null || edge.from == spotlightId || edge.to == spotlightId;
      final color = _edgeColor(edge.type);
      final paint = Paint()
        ..color = color.withValues(alpha: spotlightId == null ? 0.58 : (incident ? 0.95 : 0.07))
        ..strokeWidth = incident && spotlightId != null ? 2.4 : 1.45;
      canvas.drawLine(from.offset, to.offset, paint);
      _drawArrow(canvas, from.offset, to.offset, color.withValues(alpha: incident ? 0.9 : 0.07));
    }

    final ordered = [...scene.nodes]..sort((a, b) => projected[a.id]!.depth.compareTo(projected[b.id]!.depth));
    for (final node in ordered) {
      final point = projected[node.id]!;
      final nodeSelected = node.id == selectedId;
      final nodeConnected = spotlightId == null || connected.contains(node.id) || node.ownerId == scene.ownerOf(spotlightId);
      _drawNode(canvas, node, point, selected: nodeSelected, connected: nodeConnected);
    }
  }

  void _drawCluster(
    Canvas canvas,
    VisualCluster cluster,
    ProjectedPoint projected, {
    required bool active,
    required bool related,
    required bool dim,
  }) {
    final radius = math.max(42.0, cluster.radius * projected.scale);
    final core = cluster.ownerId == 'totem-core';
    final color = core ? const Color(0xFF22D3EE) : const Color(0xFF60A5FA);
    final alpha = active ? 0.75 : related ? 0.4 : dim ? 0.08 : 0.25;
    canvas.drawCircle(projected.offset, radius, Paint()..color = color.withValues(alpha: alpha * 0.08));
    canvas.drawCircle(
      projected.offset,
      radius,
      Paint()
        ..color = color.withValues(alpha: alpha)
        ..style = PaintingStyle.stroke
        ..strokeWidth = active ? 2.4 : 1.2,
    );
    canvas.drawOval(
      Rect.fromCenter(center: projected.offset, width: radius * 1.55, height: radius * 0.4),
      Paint()
        ..color = color.withValues(alpha: alpha * 0.35)
        ..style = PaintingStyle.stroke,
    );
  }

  void _drawNode(
    Canvas canvas,
    VisualNode node,
    ProjectedPoint projected, {
    required bool selected,
    required bool connected,
  }) {
    final child = node.isChild;
    final radius = child ? (node.kind == 'capability' ? 6.0 : 5.3) : math.max(8.0, 12 * projected.scale);
    final fill = switch (node.kind) {
      'external' => const Color(0xFFFBBF24),
      'capability' => const Color(0xFFF472B6),
      'feature' => const Color(0xFF93C5FD),
      _ when node.rank == 3 => const Color(0xFF22D3EE),
      _ => const Color(0xFF60A5FA),
    };
    final stroke = node.feature?.hasCrossModuleRelations == true ? const Color(0xFFFBBF24) : fill;
    final alpha = connected ? 1.0 : 0.18;

    if (selected) {
      canvas.drawCircle(
        projected.offset,
        radius + 7,
        Paint()
          ..color = Colors.white.withValues(alpha: 0.92)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.5,
      );
    }
    canvas.drawCircle(projected.offset, radius, Paint()..color = fill.withValues(alpha: alpha));
    canvas.drawCircle(
      projected.offset,
      radius,
      Paint()
        ..color = stroke.withValues(alpha: alpha)
        ..style = PaintingStyle.stroke
        ..strokeWidth = child ? 1.4 : 1.1,
    );

    final textPainter = TextPainter(
      text: TextSpan(
        text: node.label,
        style: TextStyle(
          color: const Color(0xFFDBEAFE).withValues(alpha: connected ? 1 : 0.22),
          fontSize: child ? 10.5 : 12,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
      textDirection: TextDirection.ltr,
      maxLines: 1,
      ellipsis: '…',
    )..layout(maxWidth: child ? 230 : 190);
    textPainter.paint(canvas, projected.offset + Offset(radius + 6, -textPainter.height / 2));
  }

  void _drawArrow(Canvas canvas, Offset from, Offset to, Color color) {
    final delta = to - from;
    if (delta.distance < 10) return;
    final direction = delta / delta.distance;
    final tip = to - direction * 14;
    final normal = Offset(-direction.dy, direction.dx);
    final path = Path()
      ..moveTo(tip.dx, tip.dy)
      ..lineTo((tip - direction * 8 + normal * 4).dx, (tip - direction * 8 + normal * 4).dy)
      ..lineTo((tip - direction * 8 - normal * 4).dx, (tip - direction * 8 - normal * 4).dy)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  Color _edgeColor(String type) => switch (type) {
        'hard-core' => const Color(0xFF60A5FA),
        'fabric-suggests' => const Color(0xFFFBBF24),
        'external-service' => const Color(0xFF22D3EE),
        'shared-capability' => const Color(0xFFF472B6),
        _ => const Color(0xFFA78BFA),
      };

  @override
  bool shouldRepaint(covariant _GraphPainter oldDelegate) => true;
}