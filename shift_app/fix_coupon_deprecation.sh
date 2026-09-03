#!/usr/bin/env bash
set -euo pipefail
cd /workspaces/shift-app/shift_app

cat > 'lib/features/coupon/presentation/coupon_screen.dart' << 'SHIFTEOF'
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../marquee/data/marquee_repository.dart';
import '../data/coupon_repository.dart';

/// מסך הזנת קוד קופון — נגיש דרך אייקון בתפריט מסך הבית. קורא ל-RPC
/// `redeem_coupon(p_code)` הקיים בשרת מאז מיגרציה 0003 (`claude/17`) —
/// לא נוגע בטבלת `coupons`/`coupon_redemptions` ישירות, בדיוק כמו שאר
/// מסכי הקצה (feedback/marquee) שתמיד עוברים דרך RPC ולא דרך הטבלה.
class CouponScreen extends ConsumerStatefulWidget {
  const CouponScreen({super.key});

  @override
  ConsumerState<CouponScreen> createState() => _CouponScreenState();
}

class _CouponScreenState extends ConsumerState<CouponScreen> {
  final _controller = TextEditingController();
  bool _loading = false;
  CouponRedemptionResult? _result;
  String? _errorMessage;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _controller.text.trim();
    if (code.isEmpty) return;

    setState(() {
      _loading = true;
      _result = null;
      _errorMessage = null;
    });

    try {
      final result = await ref.read(couponRepositoryProvider).redeem(code);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _result = result;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = 'coupon_screen.error_generic'.tr();
      });
    }
  }

  String _tierLabel(String tier) => switch (tier) {
        'monthly' => 'coupon_screen.tier_monthly'.tr(),
        'annual' => 'coupon_screen.tier_annual'.tr(),
        'annual_premium' => 'coupon_screen.tier_annual_premium'.tr(),
        _ => tier,
      };

  String _reasonMessage(String reason) => switch (reason) {
        'not_found' => 'coupon_screen.error_not_found'.tr(),
        'inactive' => 'coupon_screen.error_inactive'.tr(),
        'expired' => 'coupon_screen.error_expired'.tr(),
        'redemption_limit_reached' => 'coupon_screen.error_limit'.tr(),
        'already_redeemed' => 'coupon_screen.error_already_redeemed'.tr(),
        _ => 'coupon_screen.error_generic'.tr(),
      };

  String _formatDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  @override
  Widget build(BuildContext context) {
    final marquee = ref.watch(marqueeMessagesProvider);

    return Scaffold(
      appBar: AppBar(title: Text('coupon_screen.app_title'.tr())),
      body: SafeArea(
        child: Column(
          children: [
            marquee.when(
              data: (messages) => MarqueeBar(
                messages: messages.map((m) => m.message).toList(),
              ),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    'coupon_screen.title'.tr(),
                    style:
                        Theme.of(context).textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w900,
                            ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'coupon_screen.subtitle'.tr(),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: context.palette.inkSoft,
                        ),
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _controller,
                    textCapitalization: TextCapitalization.characters,
                    decoration: InputDecoration(
                      hintText: 'coupon_screen.field_hint'.tr(),
                      border: const OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _submit(),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _loading ? null : _submit,
                      child: _loading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text('coupon_screen.redeem_button'.tr()),
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (_errorMessage != null)
                    _MessageCard(text: _errorMessage!, isSuccess: false),
                  if (_result != null) _buildResultCard(context),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResultCard(BuildContext context) {
    final result = _result!;
    if (!result.success) {
      return _MessageCard(
        text: _reasonMessage(result.reason),
        isSuccess: false,
      );
    }
    if (result.reason == 'granted' &&
        result.grantedTier != null &&
        result.newExpiresAt != null) {
      return _MessageCard(
        title: 'coupon_screen.success_granted_title'.tr(),
        text: 'coupon_screen.success_granted_body'.tr(args: [
          _tierLabel(result.grantedTier!),
          _formatDate(result.newExpiresAt!),
        ]),
        isSuccess: true,
      );
    }
    return _MessageCard(
      text: 'coupon_screen.success_tracked'.tr(),
      isSuccess: true,
    );
  }
}

class _MessageCard extends StatelessWidget {
  final String? title;
  final String text;
  final bool isSuccess;

  const _MessageCard({
    this.title,
    required this.text,
    required this.isSuccess,
  });

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final color = isSuccess
        ? Theme.of(context).colorScheme.primary
        : Theme.of(context).colorScheme.error;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isSuccess
            ? palette.accentSoft
            : color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isSuccess
              ? palette.accentSoftLine
              : color.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Text(
              title!,
              style: TextStyle(fontWeight: FontWeight.w800, color: color),
            ),
            const SizedBox(height: 4),
          ],
          Text(text, style: TextStyle(color: color)),
        ],
      ),
    );
  }
}
SHIFTEOF

echo ""
echo "✅ תוקן: withOpacity -> withValues (מסיר את שתי ה-info האחרונות)."
