import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/i18n/strings.dart';
import 'app/shell.dart';
import 'app/theme/app_theme.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/login_screen.dart';

void main() {
  runApp(const ProviderScope(child: RiyadaHrApp()));
}

class RiyadaHrApp extends ConsumerWidget {
  const RiyadaHrApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);

    return MaterialApp(
      title: 'Riyada HR',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: ThemeMode.system,
      // Arabic first: it is the product's default, as on the web.
      locale: const Locale('ar'),
      supportedLocales: S.supported,
      localizationsDelegates: const [
        SDelegate(),
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: auth.restoring
          ? const _Splash()
          : (auth.signedIn ? const AppShell() : const LoginScreen()),
    );
  }
}

/// Shown only while the stored refresh token is being tried — a returning
/// user should land on their queue, not on a login form.
class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator(strokeWidth: 2)),
    );
  }
}
