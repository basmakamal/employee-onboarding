import 'package:flutter/material.dart';

import 'tokens.dart';

/// Material 3, tuned for a dense data product: flat surfaces with borders
/// rather than shadows, compact rows, and a type scale that stays readable
/// in Arabic at the same sizes.
ThemeData buildTheme(Brightness brightness) {
  final c = brightness == Brightness.dark ? AppColors.dark : AppColors.light;
  final onPrimary = brightness == Brightness.dark
      ? const Color(0xFF0B1119)
      : Colors.white;

  final scheme = ColorScheme(
    brightness: brightness,
    primary: c.primary,
    onPrimary: onPrimary,
    secondary: c.secondary,
    onSecondary: Colors.white,
    error: c.danger,
    onError: Colors.white,
    surface: c.surface,
    onSurface: c.ink,
    outline: c.outline,
  );

  final base = ThemeData(useMaterial3: true, colorScheme: scheme);

  return base.copyWith(
    scaffoldBackgroundColor: c.background,
    extensions: <ThemeExtension<dynamic>>[c],
    textTheme: base.textTheme.apply(
      bodyColor: c.ink,
      displayColor: c.ink,
      // Arabic sets a touch larger for legibility at the same scale.
      fontSizeFactor: 1.0,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      foregroundColor: c.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      color: c.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(T.rCard),
        side: BorderSide(color: c.outline),
      ),
    ),
    dividerTheme: DividerThemeData(color: c.outline, space: 1, thickness: 1),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.surface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(T.rButton),
        borderSide: BorderSide(color: c.outline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(T.rButton),
        borderSide: BorderSide(color: c.outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(T.rButton),
        borderSide: BorderSide(color: c.primary, width: 1.6),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(T.rButton),
        ),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.ink,
        side: BorderSide(color: c.outline),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(T.rButton),
        ),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: c.tint,
      elevation: 0,
      height: 66,
      labelTextStyle: WidgetStatePropertyAll(
        TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c.muted),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(T.rButton),
      ),
    ),
  );
}
