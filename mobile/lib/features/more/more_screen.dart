import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/i18n/strings.dart';
import '../../app/theme/tokens.dart';
import '../auth/auth_controller.dart';

/// More: identity, language, privacy, sign out. A list page, not a drawer.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final c = context.c;
    final user = ref.watch(authControllerProvider).user;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: T.s16,
        title: Text(
          s.tabMore,
          style: const TextStyle(
              fontSize: 21, fontWeight: FontWeight.w700, letterSpacing: -0.4),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(T.s16, T.s12, T.s16, T.s24),
        children: [
          if (user != null)
            Container(
              padding: const EdgeInsets.all(T.s12),
              decoration: BoxDecoration(
                color: c.surface,
                borderRadius: BorderRadius.circular(T.rCard),
                border: Border.all(color: c.outline),
              ),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: c.tint,
                      borderRadius: BorderRadius.circular(T.rButton),
                      border: Border.all(color: c.outline),
                    ),
                    alignment: Alignment.center,
                    child: Icon(Icons.person_outline, color: c.primary),
                  ),
                  const SizedBox(width: T.s12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user.name,
                            style: const TextStyle(
                                fontSize: 15, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 2),
                        Text('${user.email} · ${user.role}',
                            style: TextStyle(fontSize: 11.5, color: c.muted)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: T.s12),
          _Tile(
            icon: Icons.translate,
            label: s.language,
            onTap: () {
              final next = s.isAr ? const Locale('en') : const Locale('ar');
              ref.read(localeProvider.notifier).state = next;
            },
          ),
          _Tile(
            icon: Icons.privacy_tip_outlined,
            label: s.privacy,
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const _PrivacyScreen()),
            ),
          ),
          _Tile(
            icon: Icons.logout,
            label: s.signOut,
            color: c.danger,
            onTap: () => ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
    );
  }
}

/// App-wide locale override; null follows the default (Arabic).
final localeProvider = StateProvider<Locale?>((ref) => null);

class _Tile extends StatelessWidget {
  const _Tile({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Padding(
      padding: const EdgeInsets.only(bottom: T.s8),
      child: Material(
        color: c.surface,
        borderRadius: BorderRadius.circular(T.rCard),
        child: InkWell(
          borderRadius: BorderRadius.circular(T.rCard),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(T.s12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(T.rCard),
              border: Border.all(color: c.outline),
            ),
            child: Row(
              children: [
                Icon(icon, size: 20, color: color ?? c.muted),
                const SizedBox(width: T.s12),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: color ?? c.ink,
                    ),
                  ),
                ),
                Icon(Icons.chevron_right, size: 18, color: c.muted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Store-compliance D5. States what is true today: accounts are managed by
/// the employer and deletion goes through HR. The policy URL row appears
/// once legal publishes one (passed at build time, never hardcoded).
class _PrivacyScreen extends StatelessWidget {
  const _PrivacyScreen();

  static const _policyUrl = String.fromEnvironment('PRIVACY_POLICY_URL');

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;

    Widget block(String title, String body) => Padding(
          padding: const EdgeInsets.only(bottom: T.s16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: const TextStyle(
                      fontSize: 13.5, fontWeight: FontWeight.w700)),
              const SizedBox(height: T.s4),
              Text(body,
                  style:
                      TextStyle(fontSize: 12.5, color: c.muted, height: 1.6)),
            ],
          ),
        );

    return Scaffold(
      appBar: AppBar(title: Text(s.privacy)),
      body: ListView(
        padding: const EdgeInsets.all(T.s16),
        children: [
          block(s.privacyAccountTitle, s.privacyAccountBody),
          block(s.privacyDataTitle, s.privacyDataBody),
          block(s.privacyDeleteTitle, s.privacyDeleteBody),
          if (_policyUrl.isNotEmpty)
            block(s.privacyPolicyTitle, _policyUrl),
        ],
      ),
    );
  }
}
