import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:totem_workspace_viewer/live/workspace_live.dart';
import 'package:totem_workspace_viewer/widgets/activity_location.dart';

void main() {
  test('file edits expose an ephemeral module and source locator', () {
    final location = ActivitySourceLocation.fromEvent(
      const AgentActivityEvent(
        sequence: 42,
        timestamp: '2026-09-05T00:00:00Z',
        type: 'file_edit',
        source: 'codex-adapter',
        moduleId: 'totem-core',
        featureId: 'totem-core.feature-5',
        componentId: 'component:totem-core:api',
        file: 'src/main/java/example/CoreApi.java',
        symbol: 'CoreApi.register',
      ),
      moduleName: 'TotemCore',
    );

    expect(location, isNotNull);
    expect(
      location!.pathLabel,
      'TotemCore · src/main/java/example/CoreApi.java',
    );
    expect(location.semanticTargets, <String>[
      'Feature · totem-core.feature-5',
      'Component · component:totem-core:api',
      'Symbol · CoreApi.register',
    ]);
  });

  test('non-edit activity never creates a source locator', () {
    final location = ActivitySourceLocation.fromEvent(
      const AgentActivityEvent(
        sequence: 43,
        timestamp: '2026-09-05T00:00:00Z',
        type: 'tool_completed',
        source: 'codex-adapter',
        file: 'src/main/java/example/CoreApi.java',
      ),
      moduleName: 'TotemCore',
    );

    expect(location, isNull);
  });

  testWidgets('location card is an actionable transient source locator', (
    tester,
  ) async {
    var selected = false;
    var keptOpen = false;
    Rect? anchor;
    final hoverStates = <bool>[];
    const location = ActivitySourceLocation(
      moduleId: 'totem-core',
      moduleName: 'TotemCore',
      file: 'src/main/java/example/CoreApi.java',
      symbol: 'CoreApi.register',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: 320,
              child: ActivitySourceLocationCard(
                location: location,
                onTap: (value) {
                  selected = true;
                  anchor = value;
                },
                keptOpen: false,
                onKeepOpenChanged: () => keptOpen = true,
                onHoverChanged: hoverStates.add,
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('查看變更位置'));
    expect(selected, isTrue);
    expect(anchor, isNotNull);
    expect(anchor!.size, isNot(Size.zero));

    await tester.tap(find.text('繼續開著'));
    expect(keptOpen, isTrue);

    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: const Offset(1, 1));
    await mouse.moveTo(tester.getCenter(find.text('查看變更位置')));
    await tester.pump();
    expect(hoverStates, contains(true));

    await mouse.moveTo(const Offset(799, 599));
    await tester.pump();
    expect(hoverStates.last, isFalse);
  });
}
