import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../render/data/render_providers.dart';

/// הודעה בודדת בפס הנייד — נטענת מטבלת `marquee_messages` (מיגרציה 0005,
/// `claude/20`). ירון עורך את התוכן עצמו דרך Table Editor, בדיוק כמו
/// קופונים; האפליקציה רק קוראת (יש לה policy לקריאה בלבד על שורות
/// פעילות — הסינון של is_active/starts_at/ends_at קורה כבר בשרת).
@immutable
class MarqueeMessage {
  final String id;
  final String message;
  final int sortOrder;

  const MarqueeMessage({
    required this.id,
    required this.message,
    required this.sortOrder,
  });

  factory MarqueeMessage.fromRow(Map<String, dynamic> row) => MarqueeMessage(
        id: row['id'] as String,
        message: row['message'] as String,
        sortOrder: row['sort_order'] as int? ?? 0,
      );
}

class MarqueeRepository {
  final SupabaseClient _client;
  const MarqueeRepository(this._client);

  Future<List<MarqueeMessage>> activeMessages() async {
    final rows = await _client
        .from('marquee_messages')
        .select('id, message, sort_order')
        .order('sort_order');
    return (rows as List)
        .map((r) => MarqueeMessage.fromRow(r as Map<String, dynamic>))
        .toList();
  }
}

final marqueeRepositoryProvider = Provider<MarqueeRepository>((ref) {
  return MarqueeRepository(ref.watch(supabaseClientProvider));
});

/// `autoDispose` — נטען מחדש בכל פעם שמסך עם פס נייד נפתח, כדי שעדכון
/// שירון עשה ב-Table Editor (למשל מבצע חדש) יופיע בלי לדרוש עדכון גרסה.
final marqueeMessagesProvider =
    FutureProvider.autoDispose<List<MarqueeMessage>>((ref) {
  return ref.watch(marqueeRepositoryProvider).activeMessages();
});
