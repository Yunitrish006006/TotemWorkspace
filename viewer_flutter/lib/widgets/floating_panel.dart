import 'dart:math' as math;

import 'package:flutter/material.dart';

/// A deliberate, responsive docking model for panels that sit above the graph.
///
/// Free-form dragging makes it too easy to lose controls off-screen (especially
/// after a resize).  A panel instead opens a position list and snaps to one of
/// these safe, visible anchors.
enum FloatingPanelDock {
  topLeft,
  topCenter,
  topRight,
  centerLeft,
  center,
  centerRight,
  bottomLeft,
  bottomCenter,
  bottomRight,
}

extension FloatingPanelDockPresentation on FloatingPanelDock {
  Alignment get alignment => switch (this) {
        FloatingPanelDock.topLeft => Alignment.topLeft,
        FloatingPanelDock.topCenter => Alignment.topCenter,
        FloatingPanelDock.topRight => Alignment.topRight,
        FloatingPanelDock.centerLeft => Alignment.centerLeft,
        FloatingPanelDock.center => Alignment.center,
        FloatingPanelDock.centerRight => Alignment.centerRight,
        FloatingPanelDock.bottomLeft => Alignment.bottomLeft,
        FloatingPanelDock.bottomCenter => Alignment.bottomCenter,
        FloatingPanelDock.bottomRight => Alignment.bottomRight,
      };

  String get label => switch (this) {
        FloatingPanelDock.topLeft => '左上',
        FloatingPanelDock.topCenter => '上中',
        FloatingPanelDock.topRight => '右上',
        FloatingPanelDock.centerLeft => '左中',
        FloatingPanelDock.center => '中央',
        FloatingPanelDock.centerRight => '右中',
        FloatingPanelDock.bottomLeft => '左下',
        FloatingPanelDock.bottomCenter => '下中',
        FloatingPanelDock.bottomRight => '右下',
      };
}

/// A compact, movable-by-dock window for graph-adjacent controls.
///
/// The position button always shows a list before anything moves. This keeps
/// panel placement discoverable and prevents an accidental panel drag from
/// changing the 3D camera gesture.
class FloatingPanel extends StatelessWidget {
  const FloatingPanel({
    super.key,
    required this.title,
    required this.icon,
    required this.dock,
    required this.collapsed,
    required this.onCollapsedChanged,
    required this.onDockChanged,
    required this.child,
    this.width = 380,
    this.expandedHeight,
    this.onClose,
  });

  final String title;
  final IconData icon;
  final FloatingPanelDock dock;
  final bool collapsed;
  final ValueChanged<bool> onCollapsedChanged;
  final ValueChanged<FloatingPanelDock> onDockChanged;
  final Widget child;
  final double width;
  final double? expandedHeight;
  final VoidCallback? onClose;

  Future<void> _chooseDock(BuildContext context) async {
    final selected = await showModalBottomSheet<FloatingPanelDock>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              title: Text('移動「$title」'),
              subtitle: const Text('選擇一個固定位置；面板會保持在畫面內。'),
            ),
            const Divider(height: 1),
            for (final candidate in FloatingPanelDock.values)
              ListTile(
                leading: Icon(
                  candidate == dock ? Icons.radio_button_checked : Icons.radio_button_off,
                  color: candidate == dock ? const Color(0xFF67E8F9) : const Color(0xFF8FA5BD),
                ),
                title: Text(candidate.label),
                onTap: () => Navigator.of(context).pop(candidate),
              ),
          ],
        ),
      ),
    );
    if (selected != null) onDockChanged(selected);
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          final panelWidth = math.min(width, math.max(0.0, constraints.maxWidth - 24)).toDouble();
          const headerHeight = 42.0;
          final availableBodyHeight = math.max(0.0, constraints.maxHeight - 24 - headerHeight).toDouble();
          final panelHeight = expandedHeight == null
              ? null
              : math.min(expandedHeight!, availableBodyHeight).toDouble();
          return Align(
            alignment: dock.alignment,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: SizedBox(
                width: panelWidth,
                child: Material(
                  color: const Color(0xF2071522),
                  elevation: 14,
                  shadowColor: Colors.black,
                  clipBehavior: Clip.antiAlias,
                  shape: RoundedRectangleBorder(
                    side: const BorderSide(color: Color(0xFF2D435C)),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Semantics(
                        container: true,
                        label: '$title 浮動面板',
                        child: SizedBox(
                          height: headerHeight,
                          child: Row(
                            children: [
                              const SizedBox(width: 12),
                              Icon(icon, size: 17, color: const Color(0xFF93C5FD)),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  title,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                                ),
                              ),
                              IconButton(
                                tooltip: '選擇面板位置',
                                onPressed: () => _chooseDock(context),
                                icon: const Icon(Icons.open_with, size: 18),
                              ),
                              IconButton(
                                tooltip: collapsed ? '展開面板' : '收合面板',
                                onPressed: () => onCollapsedChanged(!collapsed),
                                icon: Icon(collapsed ? Icons.expand_more : Icons.expand_less, size: 20),
                              ),
                              if (onClose != null)
                                IconButton(
                                  tooltip: '關閉面板',
                                  onPressed: onClose,
                                  icon: const Icon(Icons.close, size: 18),
                                ),
                              const SizedBox(width: 2),
                            ],
                          ),
                        ),
                      ),
                      if (!collapsed)
                        if (panelHeight == null)
                          child
                        else
                          SizedBox(height: panelHeight, child: child),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      );
}
