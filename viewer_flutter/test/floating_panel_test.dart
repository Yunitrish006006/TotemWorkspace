import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:totem_workspace_viewer/widgets/floating_panel.dart';

void main() {
  testWidgets('floating panels collapse and use an explicit dock list', (
    tester,
  ) async {
    var dock = FloatingPanelDock.topLeft;
    var collapsed = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) => SizedBox.expand(
              child: Stack(
                children: [
                  FloatingPanel(
                    title: '測試面板',
                    icon: Icons.tune,
                    dock: dock,
                    collapsed: collapsed,
                    onCollapsedChanged: (value) =>
                        setState(() => collapsed = value),
                    onDockChanged: (value) => setState(() => dock = value),
                    child: const Text('面板內容'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('面板內容'), findsOneWidget);
    await tester.tap(find.byTooltip('收合面板'));
    await tester.pump();
    expect(find.text('面板內容'), findsNothing);

    await tester.tap(find.byTooltip('展開面板'));
    await tester.pump();
    await tester.tap(find.byTooltip('選擇面板位置'));
    await tester.pumpAndSettle();
    expect(find.text('移動「測試面板」'), findsOneWidget);
    expect(find.text('左上'), findsOneWidget);
    expect(find.text('右上'), findsOneWidget);

    await tester.tap(find.text('右上'));
    await tester.pumpAndSettle();
    expect(dock, FloatingPanelDock.topRight);
  });
}
