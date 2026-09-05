import 'package:flutter/material.dart';

/// Shows an output message in two visual lines until the reader asks for more.
///
/// The overflow check is layout-aware, so a long wrapped line behaves the same
/// as a message containing explicit newlines.
class CollapsibleMessage extends StatefulWidget {
  const CollapsibleMessage({
    super.key,
    required this.text,
    required this.style,
  });

  final String text;
  final TextStyle style;

  @override
  State<CollapsibleMessage> createState() => _CollapsibleMessageState();
}

class _CollapsibleMessageState extends State<CollapsibleMessage> {
  bool _expanded = false;

  @override
  void didUpdateWidget(covariant CollapsibleMessage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.text != widget.text) _expanded = false;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final textPainter = TextPainter(
          text: TextSpan(text: widget.text, style: widget.style),
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
          maxLines: 2,
        )..layout(maxWidth: constraints.maxWidth);
        final canCollapse = textPainter.didExceedMaxLines;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!_expanded && canCollapse)
              Text(
                widget.text,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: widget.style,
              )
            else
              SelectableText(widget.text, style: widget.style),
            if (canCollapse)
              TextButton.icon(
                onPressed: () => setState(() => _expanded = !_expanded),
                icon: Icon(
                  _expanded ? Icons.expand_less : Icons.expand_more,
                  size: 15,
                ),
                label: Text(_expanded ? '收起訊息' : '展開完整訊息'),
                style: TextButton.styleFrom(
                  foregroundColor: const Color(0xFF7DD3FC),
                  minimumSize: const Size(0, 28),
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  textStyle: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
