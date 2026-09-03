import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// פס הודעות/פרסומות נייד בראש המסכים "הרגילים" — נע **משמאל לימין**
/// (בקשה מפורשת של ירון, גם שזה לא כיוון קריאה טבעי בעברית). לא מוצג
/// במסך צילום התמונה ולא במסך העיבוד (states חולפים) — כל מסך מחליט
/// בעצמו אם להציב את הווידג'ט הזה, זה לא global.
///
/// תוכן ההודעות מגיע מ-[marqueeMessagesProvider] (טבלת `marquee_messages`,
/// שירון עורך דרך Table Editor). אם אין הודעות פעילות, הפס פשוט לא נבנה
/// בכלל (גובה 0) — לא משאיר רצועה ריקה.
class MarqueeBar extends StatefulWidget {
  final List<String> messages;

  const MarqueeBar({super.key, required this.messages});

  @override
  State<MarqueeBar> createState() => _MarqueeBarState();
}

class _MarqueeBarState extends State<MarqueeBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 16),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.messages.isEmpty) return const SizedBox.shrink();

    final text = widget.messages.join('     •     ');
    final palette = context.palette;
    final accent = Theme.of(context).colorScheme.primary;

    return Container(
      height: 34,
      width: double.infinity,
      color: palette.accentSoft,
      child: ClipRect(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return AnimatedBuilder(
              animation: _controller,
              builder: (context, _) {
                final width = constraints.maxWidth;
                // נע מ--75% הרוחב (מחוץ למסך, שמאלה) עד 100% הרוחב
                // (מחוץ למסך, ימינה) — כמו ה-keyframes במוקאפ
                // (mockups_stage6.html, .marquee-bar).
                final start = -0.75 * width;
                final end = width;
                final x = start + (end - start) * _controller.value;
                return Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Positioned(
                      left: x,
                      top: 0,
                      bottom: 0,
                      child: Center(
                        child: Text(
                          text,
                          maxLines: 1,
                          softWrap: false,
                          overflow: TextOverflow.visible,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                            color: accent,
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }
}
