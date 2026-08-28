import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// App-wide ThemeData per PRD Part 2 (UI/UX design language):
/// - Dark background, emerald / brushed-gold / clean-white accents.
/// - Modern, highly-readable Hebrew typography (Heebo, with Assistant as the
///   documented alternative in the PRD — swap in `_fontFamily` if preferred).
/// - Cards with 16px border radius.
class AppTheme {
  AppTheme._();

  static const double cardBorderRadius = 16.0;

  static TextTheme _fontFamily(TextTheme base) => GoogleFonts.heeboTextTheme(base);

  static ThemeData get dark {
    final base = ThemeData.dark(useMaterial3: true);

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.darkSlateBackground,
      colorScheme: base.colorScheme.copyWith(
        surface: AppColors.darkSlateBackground,
        primary: AppColors.emerald,
        secondary: AppColors.brushedGold,
        onPrimary: AppColors.cleanWhite,
        error: AppColors.danger,
      ),
      textTheme: _fontFamily(base.textTheme).apply(
        bodyColor: AppColors.cleanWhite,
        displayColor: AppColors.cleanWhite,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.darkSlateBackground,
        foregroundColor: AppColors.cleanWhite,
        elevation: 0,
        centerTitle: true,
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(cardBorderRadius),
        ),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: AppColors.surface,
        selectedColor: AppColors.emerald,
        labelStyle: _fontFamily(base.textTheme).bodyMedium?.copyWith(
              color: AppColors.cleanWhite,
            ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(cardBorderRadius),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.emerald,
          foregroundColor: AppColors.cleanWhite,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(cardBorderRadius),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          textStyle: _fontFamily(base.textTheme).titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
        ),
      ),
    );
  }
}
