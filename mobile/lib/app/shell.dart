import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/auth/auth_controller.dart';
import '../features/directory/directory_screen.dart';
import '../features/home/home_screen.dart';
import '../features/inbox/inbox_screen.dart';
import '../features/more/more_screen.dart';
import '../features/work/work_screen.dart';
import 'i18n/strings.dart';
import 'theme/tokens.dart';

/// Selected tab — a provider rather than widget state so a dashboard tile
/// can open the Work tab pre-filtered.
final shellIndexProvider = StateProvider<int>((ref) => 0);

/// The signed-in shell. Its tab set is NOT hardcoded — it comes from
/// /api/me/capabilities, so Insurance gets three destinations and HR gets
/// five without the client knowing why.
class AppShell extends ConsumerWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final caps = ref.watch(authControllerProvider).capabilities;
    final tabs = caps?.tabs ?? const ['work'];
    final safeIndex = ref.watch(shellIndexProvider).clamp(0, tabs.length - 1);

    return Scaffold(
      body: _pageFor(tabs[safeIndex]),
      bottomNavigationBar: tabs.length < 2
          ? null
          : NavigationBar(
              selectedIndex: safeIndex,
              onDestinationSelected: (i) =>
                  ref.read(shellIndexProvider.notifier).state = i,
              destinations: [
                for (final tab in tabs)
                  NavigationDestination(
                    icon: Icon(_iconFor(tab)),
                    selectedIcon: Icon(_iconFor(tab, filled: true)),
                    label: _labelFor(s, tab),
                  ),
              ],
            ),
    );
  }

  Widget _pageFor(String tab) {
    switch (tab) {
      case 'home':
        return const HomeScreen();
      case 'work':
        return const WorkScreen();
      case 'directory':
        return const DirectoryScreen();
      case 'inbox':
        return const InboxScreen();
      case 'more':
        return const MoreScreen();
      default:
        return _Placeholder(tab: tab);
    }
  }

  String _labelFor(S s, String tab) => switch (tab) {
        'home' => s.tabHome,
        'work' => s.tabWork,
        'directory' => s.tabDirectory,
        'inbox' => s.tabInbox,
        _ => s.tabMore,
      };

  IconData _iconFor(String tab, {bool filled = false}) => switch (tab) {
        'home' => filled ? Icons.home_rounded : Icons.home_outlined,
        'work' => filled ? Icons.checklist_rounded : Icons.checklist_outlined,
        'directory' => filled ? Icons.people_rounded : Icons.people_outline,
        'inbox' =>
          filled ? Icons.notifications_rounded : Icons.notifications_outlined,
        _ => filled ? Icons.more_horiz_rounded : Icons.more_horiz,
      };
}

/// Honest stand-in for destinations that are specified but not yet built —
/// never a blank screen, never fake data.
class _Placeholder extends ConsumerWidget {
  const _Placeholder({required this.tab});

  final String tab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.c;
    final s = S.of(context);
    final user = ref.watch(authControllerProvider).user;

    return Scaffold(
      appBar: AppBar(title: Text(_title(s))),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(T.s32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.construction_outlined, size: 40, color: c.muted),
              const SizedBox(height: T.s16),
              Text(
                s.isAr ? 'قيد التطوير' : 'Not built yet',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: T.s24),
              if (user != null)
                Text(
                  '${user.name} · ${user.role}',
                  style: TextStyle(fontSize: 13, color: c.muted),
                ),
              const SizedBox(height: T.s12),
              OutlinedButton.icon(
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).signOut(),
                icon: const Icon(Icons.logout, size: 16),
                label: Text(s.signOut),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _title(S s) => switch (tab) {
        'home' => s.tabHome,
        'directory' => s.tabDirectory,
        'inbox' => s.tabInbox,
        _ => s.tabMore,
      };
}
