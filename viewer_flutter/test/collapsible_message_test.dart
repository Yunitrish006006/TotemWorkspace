import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:totem_workspace_viewer/widgets/collapsible_message.dart';

void main() {
  Widget subject(String text) => MaterialApp(
    home: Scaffold(
      body: SizedBox(
        width: 220,
        child: CollapsibleMessage(
          text: text,
          style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
        ),
      ),
    ),
  );

  testWidgets('long output starts collapsed and can be expanded', (
    tester,
  ) async {
    const output = 'first output line\nsecond output line\nthird output line';
    await tester.pumpWidget(subject(output));

    final collapsedOutput = tester.widget<Text>(find.text(output));
    expect(collapsedOutput.maxLines, 2);
    expect(find.text('展開完整訊息'), findsOneWidget);

    await tester.tap(find.text('展開完整訊息'));
    await tester.pump();
    expect(find.text('收起訊息'), findsOneWidget);

    await tester.tap(find.text('收起訊息'));
    await tester.pump();
    expect(tester.widget<Text>(find.text(output)).maxLines, 2);
  });

  testWidgets('two-line output stays fully visible without a control', (
    tester,
  ) async {
    await tester.pumpWidget(subject('first line\nsecond line'));

    expect(find.text('展開完整訊息'), findsNothing);
    expect(find.text('收起訊息'), findsNothing);
  });

  testWidgets('a wrapped output line also defaults to collapsed', (
    tester,
  ) async {
    const output =
        'a long console response that wraps beyond the two visible lines in this narrow panel';
    await tester.pumpWidget(subject(output));

    expect(find.text('展開完整訊息'), findsOneWidget);
    expect(tester.widget<Text>(find.text(output)).maxLines, 2);
  });
}
