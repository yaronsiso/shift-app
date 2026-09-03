import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';

/// Stage-2 placeholder screen.
///
/// Purpose: prove the project boots, the theme/i18n are wired correctly,
/// and the Supabase connection (URL + anon key + `profiles` table from
/// supabase/migrations/0001_init.sql) actually works end-to-end.
///
/// This is intentionally NOT the real home/upload screen from the PRD
/// (camera / gallery upload, project-type picker) — that's built in
/// stage 3/6 once this scaffold is approved.
///
/// **שלב 6 (שחזור/איחוד):** עודכן רק בגלל שינוי טוקני הצבע ב-app_colors.dart
/// (AppColors.emerald / AppColors.mutedText כבר לא קיימים בפלטה החדשה) —
/// שום שינוי לוגי אחר. המסך הזה עדיין זמני; יוחלף כש-app_router.dart יחובר
/// למסכי שלב 6 האמיתיים.
class HomePlaceholderScreen extends StatefulWidget {
  const HomePlaceholderScreen({super.key});

  @override
  State<HomePlaceholderScreen> createState() => _HomePlaceholderScreenState();
}

class _HomePlaceholderScreenState extends State<HomePlaceholderScreen> {
  late final Future<bool> _connectionCheck;

  @override
  void initState() {
    super.initState();
    _connectionCheck = _checkSupabaseConnection();
  }

  Future<bool> _checkSupabaseConnection() async {
    try {
      // Lightweight read against the schema defined in
      // supabase/migrations/0001_init.sql. Succeeds once that migration
      // has been run in the user's Supabase project.
      await Supabase.instance.client.from('profiles').select('id').limit(1);
      return true;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(AppConfig.appName),
        actions: [
          PopupMenuButton<Locale>(
            icon: const Icon(Icons.language),
            tooltip: 'language.select'.tr(),
            onSelected: (locale) => context.setLocale(locale),
            itemBuilder: (context) => context.supportedLocales
                .map(
                  (locale) => PopupMenuItem(
                    value: locale,
                    child: Text('language.${locale.languageCode}'.tr()),
                  ),
                )
                .toList(),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'home.title'.tr(),
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'home.placeholder_note'.tr(),
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: context.palette.inkSoft),
                  ),
                  const SizedBox(height: 24),
                  FutureBuilder<bool>(
                    future: _connectionCheck,
                    builder: (context, snapshot) {
                      if (!snapshot.hasData) {
                        return CircularProgressIndicator(
                          color: Theme.of(context).colorScheme.primary,
                        );
                      }
                      final connected = snapshot.data!;
                      return Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            connected ? Icons.check_circle : Icons.error,
                            color: connected
                                ? Theme.of(context).colorScheme.primary
                                : AppColors.danger,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            connected
                                ? 'home.connected'.tr()
                                : 'home.not_connected'.tr(),
                          ),
                        ],
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
