import 'package:flutter/material.dart';

/// Design tokens, lifted verbatim from the web theme
/// (frontend/src/plugins/vuetify.ts) so the two products read as one system.
///
/// Status colour is semantic and declared once here — the web repeats its
/// status→colour map in three files, and that is the bug this prevents.
class T {
  const T._();

  // ── spacing: 4pt grid ────────────────────────────────────────────────────
  static const double s4 = 4;
  static const double s8 = 8;
  static const double s12 = 12;
  static const double s16 = 16;
  static const double s24 = 24;
  static const double s32 = 32;

  // ── geometry ─────────────────────────────────────────────────────────────
  static const double rCard = 16;
  static const double rButton = 12;
  static const double rChip = 999;
  static const double rSheet = 28;
  static const double rowMinHeight = 64;
}

/// Palette for one theme mode.
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.primary,
    required this.secondary,
    required this.surface,
    required this.background,
    required this.success,
    required this.warning,
    required this.danger,
    required this.ink,
    required this.muted,
    required this.outline,
    required this.tint,
  });

  final Color primary;
  final Color secondary;
  final Color surface;
  final Color background;
  final Color success;
  final Color warning;
  final Color danger;
  final Color ink;
  final Color muted;
  final Color outline;

  /// Faint primary wash — unread rows, avatars, selected states.
  final Color tint;

  static const light = AppColors(
    primary: Color(0xFF1867C0),
    secondary: Color(0xFF00695C),
    surface: Color(0xFFFFFFFF),
    background: Color(0xFFF4F6FA),
    success: Color(0xFF2E7D32),
    warning: Color(0xFFED6C02),
    danger: Color(0xFFC62828),
    ink: Color(0xFF101826),
    muted: Color(0xFF62708A),
    outline: Color(0xFFE1E6EF),
    tint: Color(0x0F1867C0),
  );

  static const dark = AppColors(
    primary: Color(0xFF5C9EEB),
    secondary: Color(0xFF26A69A),
    surface: Color(0xFF161B26),
    background: Color(0xFF0E1117),
    success: Color(0xFF66BB6A),
    warning: Color(0xFFFFA726),
    danger: Color(0xFFEF5350),
    ink: Color(0xFFE6ECF5),
    muted: Color(0xFF8A97AC),
    outline: Color(0xFF232C3A),
    tint: Color(0x1A5C9EEB),
  );

  /// The one place a workflow status becomes a colour.
  Color forStatus(String status) {
    switch (status) {
      case 'DONE':
      case 'APPROVED':
      case 'ACTIVE':
      case 'CLOSED':
        return success;
      case 'ON_HOLD':
        return warning;
      case 'EXPIRED':
      case 'REJECTED':
      case 'CANCELLED':
        return danger;
      default:
        return primary; // PENDING, and every in-flight pipeline status
    }
  }

  @override
  AppColors copyWith({
    Color? primary,
    Color? secondary,
    Color? surface,
    Color? background,
    Color? success,
    Color? warning,
    Color? danger,
    Color? ink,
    Color? muted,
    Color? outline,
    Color? tint,
  }) {
    return AppColors(
      primary: primary ?? this.primary,
      secondary: secondary ?? this.secondary,
      surface: surface ?? this.surface,
      background: background ?? this.background,
      success: success ?? this.success,
      warning: warning ?? this.warning,
      danger: danger ?? this.danger,
      ink: ink ?? this.ink,
      muted: muted ?? this.muted,
      outline: outline ?? this.outline,
      tint: tint ?? this.tint,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      primary: Color.lerp(primary, other.primary, t)!,
      secondary: Color.lerp(secondary, other.secondary, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      background: Color.lerp(background, other.background, t)!,
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      outline: Color.lerp(outline, other.outline, t)!,
      tint: Color.lerp(tint, other.tint, t)!,
    );
  }
}

/// `context.c.warning` instead of a Theme.of dance at every call site.
extension AppColorsX on BuildContext {
  AppColors get c => Theme.of(this).extension<AppColors>()!;
}
