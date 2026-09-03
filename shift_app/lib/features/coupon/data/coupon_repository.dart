import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../render/data/render_providers.dart';

/// תוצאת קריאה ל-RPC `redeem_coupon(p_code)` (מיגרציה 0003, `claude/17`).
/// שדות ה-`RETURNS TABLE` בשרת, בדיוק כמו שאומתו מול הגדרת הפונקציה
/// בפועל ב-Supabase (סשן 7): `success boolean, reason text,
/// granted_tier text, new_expires_at timestamptz`.
///
/// ערכי `reason` אפשריים: `not_found` · `inactive` · `expired` ·
/// `redemption_limit_reached` · `already_redeemed` · `tracked_only`
/// (success=true, קופון מעקב-בלבד בלי הטבה) · `granted` (success=true,
/// ניתן מנוי — `grantedTier`/`newExpiresAt` תמיד לא-null במקרה הזה).
@immutable
class CouponRedemptionResult {
  final bool success;
  final String reason;
  final String? grantedTier;
  final DateTime? newExpiresAt;

  const CouponRedemptionResult({
    required this.success,
    required this.reason,
    required this.grantedTier,
    required this.newExpiresAt,
  });

  factory CouponRedemptionResult.fromRow(Map<String, dynamic> row) {
    final expiresRaw = row['new_expires_at'] as String?;
    return CouponRedemptionResult(
      success: row['success'] as bool? ?? false,
      reason: row['reason'] as String? ?? 'unknown',
      grantedTier: row['granted_tier'] as String?,
      newExpiresAt: expiresRaw != null ? DateTime.tryParse(expiresRaw) : null,
    );
  }
}

class CouponRepository {
  final SupabaseClient _client;
  const CouponRepository(this._client);

  /// מממש קוד קופון עבור המשתמש המחובר. הפונקציה בשרת אטומית
  /// (`for update` על שורת הקופון) ובודקת בעצמה תוקף/מכסה/כפילות —
  /// האפליקציה רק מציגה את התוצאה שחוזרת.
  Future<CouponRedemptionResult> redeem(String code) async {
    final rows = await _client.rpc('redeem_coupon', params: {'p_code': code});
    final r = (rows is List && rows.isNotEmpty) ? rows.first : rows;
    return CouponRedemptionResult.fromRow(r as Map<String, dynamic>);
  }
}

final couponRepositoryProvider = Provider<CouponRepository>((ref) {
  return CouponRepository(ref.watch(supabaseClientProvider));
});
