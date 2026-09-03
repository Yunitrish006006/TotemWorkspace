import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../layout/graph_layout.dart';
import '../model/graph_data.dart';

class GraphView extends StatefulWidget {
  const GraphView({super.key, required this.data});

  final GraphData data;

  @override
  State<GraphView> createState() => _GraphViewState();
}

class _GraphViewState extends State<GraphView> {
  late GraphLayoutResult _layout;
  Camera3d _camera = const Camera3d();
  String? _selectedId = 'totem-core';

  @override
  void initState() {
    super.initState();
    _layout = buildModuleLayout(widget.data);
  }

  @override
  void didUpdateWidget(covariant GraphView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.data != widget.data) {
      _layout = buildModuleLayout(widget.data);
      if (!_layout.byId.containsKey(_selectedId)) _selectedId = 'totem-core';
    }
  }

  @override
  Widget build(BuildContext context) {
    final selected = _layout.byId[_selectedId];
    return Scaffold(
      backgroundColor: const Color(0xFF050B14),
      body: SafeArea(
        child: Column(
          children: [
            _Toolbar(
              data: widget.data,
              onReset: () => setState(() => _camera = const Camera3d()),
            ),
            Expanded(
              child: Row(
                children: [
                  Expanded(child: _buildCanvas()),
                  if (selected != null)
                    SizedBox(
                      width: 340,
                      child: _InfoPanel(
                        node: selected,
                        contracts: widget.data.contracts
                            .where((contract) => contract.from == selected.id || contract.to == selected.id)
                            .toList(growable: false),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCanvas() => LayoutBuilder(
        builder: (context, constraints) {
          final size = Size(constraints.maxWidth, constraints.maxHeight);
          return Focus(
            autofocus: true,
            onKeyEvent: (_, event) {
              if (event is! KeyDownEvent) return KeyEventResult.ignored;
              if (event.logicalKey == LogicalKeyboardKey.home) {
                setState(() => _selectedId = 'totem-core');
                return KeyEventResult.handled;
              }
              if (event.logicalKey == LogicalKeyboardKey.escape) {
                setState(() => _selectedId = null);
                return KeyEventResult.handled;
              }
              return KeyEventResult.ignored;
            },
            child: Listener(
              onPointerSignal: (event) {
                if (event is PointerScrollEvent) {
                  final factor = math.exp(-event.scrollDelta.dy * 0.001);
                  final zoom = (_camera.zoom * factor).clamp(0.32, 3.2).toDouble();
                  setState(() => _camera = _camera.copyWith(zoom: zoom));
                }
              },
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onPanUpdate: (details) {
                  setState(() {
                    final pitch = (_camera.pitch + details.delta.dy * 0.006).clamp(-1.2, 1.2).toDouble();
                    _camera = _camera.copyWith(
                      yaw: _camera.yaw + details.delta.dx * 0.008,
                      pitch: pitch,
                    );
                  });
                },
                onTapUp: (details) {
                  final id = _hitTest(details.localPosition, size);
                  setState(() => _selectedId = id);
                },
                child: CustomPaint(
                  size: Size.infinite,
                  painter: _GraphPainter(
                    data: widget.data,
                    layout: _layout,
                    camera: _camera,
                    selectedId: _selectedId,
                  ),
                ),
              ),
            ),
          );
        },
      );

  String? _hitTest(Offset point, Size size) {
    String? best;
    var bestDistance = double.infinity;
    for (final node in _layout.nodes) {
      final projected = _camera.project(node.position, size);
      final distance = (projected.offset - point).distance;
      if (distance < 28 && distance < bestDistance) {
        best = node.id;
        bestDistance = distance;
      }
    }
    return best;
  }
}

class _Toolbar extends StatelessWidget {
  const _Toolbar({required this.data, required this.onReset});

  final GraphData data;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: const BoxDecoration(
          color: Color(0xEE06101B),
          border: Border(bottom: BorderSide(color: Color(0xFF26394F))),
        ),
        child: Row(
          children: [
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('TOTEM Architecture · Flutter Phase 1', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                  Text('shared graph model · CustomPainter 3D projection', style: TextStyle(color: Color(0xFF8FA5BD), fontSize: 11)),
                ],
              ),
            ),
            _Pill('${data.modules.length} modules'),
            const SizedBox(width: 6),
            _Pill('${data.contracts.length} contracts'),
            const SizedBox(width: 6),
            _Pill('snapshot ${data.snapshotDate}'),
            const SizedBox(width: 8),
            OutlinedButton(onPressed: onReset, child: const Text('重設視角')),
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
  const _InfoPanel({required this.node, required this.contracts});

  final VisualNode node;
  final List<GraphContract> contracts;

  @override
  Widget build(BuildContext context) {
    final module = node.module;
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xF2071522),
        border: Border(left: BorderSide(color: Color(0xFF2D435C))),
      ),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(node.label, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
          if (module != null) ...[
            const SizedBox(height: 6),
            Text(module.role, style: const TextStyle(color: Color(0xFFB8C9DA), height: 1.5)),
            const SizedBox(height: 14),
            const _SectionTitle('Feature groups'),
            for (final group in module.featureGroups) _Item(group),
          ],
          const SizedBox(height: 14),
          const _SectionTitle('Relationships'),
          if (contracts.isEmpty) const _Item('No direct module-level contracts'),
          for (final contract in contracts)
            _Item('${contract.type} · ${contract.from} → ${contract.to}\n${contract.feature}'),
          const SizedBox(height: 20),
          const Text('拖曳旋轉 · 滾輪縮放 · 點節點查看 · Home 回 Core · Esc 清除', style: TextStyle(color: Color(0xFF8FA5BD), fontSize: 11)),
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
        child: Text(text.toUpperCase(), style: const TextStyle(color: Color(0xFF93C5FD), fontSize: 11, letterSpacing: 1.1, fontWeight: FontWeight.w700)),
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
    required this.layout,
    required this.camera,
    required this.selectedId,
  });

  final GraphData data;
  final GraphLayoutResult layout;
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

    final byId = layout.byId;
    final projected = {for (final node in layout.nodes) node.id: camera.project(node.position, size)};
    for (final edge in data.contracts) {
      final from = projected[edge.from];
      final to = projected[edge.to];
      if (from == null || to == null || !byId.containsKey(edge.from) || !byId.containsKey(edge.to)) continue;
      final color = _edgeColor(edge.type);
      final paint = Paint()
        ..color = color.withValues(alpha: 0.55)
        ..strokeWidth = 1.5;
      canvas.drawLine(from.offset, to.offset, paint);
      _drawArrow(canvas, from.offset, to.offset, color);
    }

    final ordered = [...layout.nodes]..sort((a, b) => projected[a.id]!.depth.compareTo(projected[b.id]!.depth));
    for (final node in ordered) {
      final point = projected[node.id]!;
      final selected = node.id == selectedId;
      final radius = math.max(8.0, 12 * point.scale);
      if (selected) {
        canvas.drawCircle(
          point.offset,
          radius + 7,
          Paint()
            ..color = Colors.white.withValues(alpha: 0.9)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2.5,
        );
      }
      final fill = node.kind == 'external'
          ? const Color(0xFFFBBF24)
          : node.rank == 3
              ? const Color(0xFF22D3EE)
              : const Color(0xFF60A5FA);
      canvas.drawCircle(point.offset, radius, Paint()..color = fill);
      final textPainter = TextPainter(
        text: TextSpan(
          text: node.label,
          style: TextStyle(
            color: const Color(0xFFDBEAFE),
            fontSize: 12,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
        textDirection: TextDirection.ltr,
        maxLines: 1,
        ellipsis: '…',
      )..layout(maxWidth: 190);
      textPainter.paint(canvas, point.offset + Offset(radius + 6, -textPainter.height / 2));
    }
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
    canvas.drawPath(path, Paint()..color = color.withValues(alpha: 0.8));
  }

  Color _edgeColor(String type) => switch (type) {
        'hard-core' => const Color(0xFF60A5FA),
        'fabric-suggests' => const Color(0xFFFBBF24),
        'external-service' => const Color(0xFF22D3EE),
        'shared-capability' => const Color(0xFFF472B6),
        _ => const Color(0xFFA78BFA),
      };

  @override
  bool shouldRepaint(covariant _GraphPainter oldDelegate) =>
      oldDelegate.camera != camera || oldDelegate.selectedId != selectedId || oldDelegate.data != data;
}
