import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../render/data/render_providers.dart' show supabaseClientProvider;
import 'auth_service.dart';

/// שירות ההתחברות/הרשמה — provider כדי שאפשר יהיה להחליף אותו ב-mock
/// בבדיקות בעתיד, בדיוק כמו renderServiceProvider.
final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService(ref.watch(supabaseClientProvider));
});

/// זרם שינויי מצב ההתחברות (מתעדכן אוטומטית אחרי sendPhoneCode/
/// verifyPhoneCode/signInWithPhonePassword/signOut וכו') — משמש כדי
/// שמסך ההתחברות עצמו (ומסכים אחרים בעתיד) יוכלו להגיב אוטומטית ברגע
/// שהמשתמש כבר לא אנונימי, בלי לדרוש רענון ידני.
final authStateChangesProvider = StreamProvider<AuthState>((ref) {
  final client = ref.watch(supabaseClientProvider);
  return client.auth.onAuthStateChange;
});

/// true אם המשתמש הנוכחי הוא רק סשן אנונימי (עוד לא נרשם/התחבר עם
/// טלפון/אימייל בפועל). תלוי ב-authStateChangesProvider כדי להתעדכן
/// אוטומטית ברגע שההרשמה/ההתחברות/היציאה מסתיימת.
final isAnonymousUserProvider = Provider.autoDispose<bool>((ref) {
  ref.watch(authStateChangesProvider);
  final client = ref.watch(supabaseClientProvider);
  return client.auth.currentUser?.isAnonymous ?? true;
});
