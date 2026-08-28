/// Global, non-secret app constants agreed in the product spec.
///
/// Anything here traces back to an explicit decision in the PRD / follow-up
/// spec documents — nothing invented. See project docs/STATUS.md for the
/// source of each value.
class AppConfig {
  AppConfig._();

  /// Brand name — also the label used on the primary action button
  /// throughout the app (per spec: the render/update button is always "SHIFT").
  static const String appName = 'SHIFT';

  /// Android application ID / iOS bundle identifier.
  static const String bundleId = 'com.shiftapp.mobile';

  /// Freemium: number of free renders a new user gets before the paywall.
  static const int freeCreditsForNewUser = 3;

  /// Supported UI locales (ISO 639-1) and their text direction.
  /// AI prompts sent to the backend are always in English regardless of
  /// the selected UI locale — see design_studio feature (stage 4/5).
  static const List<String> supportedLocaleCodes = ['he', 'ar', 'ru', 'en'];
  static const List<String> rtlLocaleCodes = ['he', 'ar'];
}
