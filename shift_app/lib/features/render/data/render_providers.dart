import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'render_service.dart';

/// לקוח Supabase — provider יחיד, נגיש מכל מקום כדי לא לכתוב
/// `Supabase.instance.client` בעשרות מקומות.
final supabaseClientProvider = Provider<SupabaseClient>((ref) {
  return Supabase.instance.client;
});

/// שירות ההדמיות (נכתב בשלב 5) — provider כדי שאפשר יהיה להחליף אותו
/// בבדיקות (mock) בעתיד.
final renderServiceProvider = Provider<RenderService>((ref) {
  return RenderService(ref.watch(supabaseClientProvider));
});

/// זכאות המשתמש הנוכחית (קרדיטים חינמיים / מנוי) — להצגת "מונית" הקרדיטים
/// במסך הבית ובמסך החומרים. `autoDispose` כי זה מידע רגיש-לזמן שכדאי
/// לרענן בכל פעם שהמסך נפתח מחדש, לא לשמור לנצח בזיכרון.
final renderEligibilityProvider =
    FutureProvider.autoDispose<RenderEligibility>((ref) {
  return ref.watch(renderServiceProvider).checkEligibility();
});
