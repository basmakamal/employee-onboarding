import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/i18n/strings.dart';
import '../../app/theme/tokens.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets/states.dart';
import '../employee/employee_screen.dart';
import 'directory_models.dart';
import 'directory_providers.dart';

/// The employee directory. Search, filter and paging all happen on the
/// server — the phone never holds the table.
class DirectoryScreen extends ConsumerStatefulWidget {
  const DirectoryScreen({super.key});

  @override
  ConsumerState<DirectoryScreen> createState() => _DirectoryScreenState();
}

class _DirectoryScreenState extends ConsumerState<DirectoryScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 400) {
      ref.read(directoryControllerProvider.notifier).loadMore();
    }
  }

  /// One request per pause in typing, not per keystroke.
  void _onQueryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      ref.read(directoryQueryProvider.notifier).state = value;
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final rows = ref.watch(directoryControllerProvider);
    final filter = ref.watch(directoryFilterProvider);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: T.s16,
        title: Text(
          s.tabDirectory,
          style: const TextStyle(
            fontSize: 21,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.4,
          ),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(102),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(T.s16, 0, T.s16, T.s8),
                child: TextField(
                  controller: _search,
                  onChanged: _onQueryChanged,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: s.searchHint,
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                    suffixIcon: _search.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            onPressed: () {
                              _search.clear();
                              _onQueryChanged('');
                              setState(() {});
                            },
                          ),
                  ),
                ),
              ),
              SizedBox(
                height: 44,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(T.s16, 0, T.s16, T.s12),
                  children: [
                    for (final entry in <(String, String)>[
                      ('all', s.all),
                      ('onboarding', s.filterOnboarding),
                      ('active', s.filterActive),
                      ('inactive', s.filterInactive),
                    ])
                      Padding(
                        padding: const EdgeInsetsDirectional.only(end: T.s8),
                        child: _FilterChip(
                          label: entry.$2,
                          selected: filter == entry.$1,
                          onTap: () => ref
                              .read(directoryFilterProvider.notifier)
                              .state = entry.$1,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      body: rows.when(
        loading: () => const ListSkeleton(itemHeight: 68),
        error: (e, _) => ErrorStateView(
          message: e is ApiException && e.code == 'OFFLINE'
              ? s.offline
              : s.somethingWrong,
          retryLabel: s.retry,
          onRetry: () =>
              ref.read(directoryControllerProvider.notifier).refresh(),
        ),
        data: (list) {
          if (list.isEmpty) {
            return EmptyStateView(
              icon: Icons.person_search_outlined,
              title: s.noResults,
              hint: s.noResultsHint,
            );
          }
          final controller = ref.read(directoryControllerProvider.notifier);
          return RefreshIndicator(
            onRefresh: controller.refresh,
            child: ListView.separated(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(T.s16, T.s12, T.s16, T.s24),
              itemCount: list.length + (controller.hasMore ? 1 : 0),
              separatorBuilder: (_, _) => const SizedBox(height: T.s8),
              itemBuilder: (context, i) {
                if (i >= list.length) {
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: T.s16),
                    child: Center(
                      child: SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  );
                }
                return _PersonRow(row: list[i]);
              },
            ),
          );
        },
      ),
      floatingActionButton: null,
      backgroundColor: c.background,
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? c.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(T.rChip),
          border: Border.all(color: selected ? c.primary : c.outline),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: selected
                ? Theme.of(context).colorScheme.onPrimary
                : c.muted,
          ),
        ),
      ),
    );
  }
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({required this.row});

  final EmployeeRow row;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final statusColor = c.forStatus(row.status);

    return Material(
      color: c.surface,
      borderRadius: BorderRadius.circular(T.rCard),
      child: InkWell(
        borderRadius: BorderRadius.circular(T.rCard),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => EmployeeScreen(employeeId: row.id),
          ),
        ),
        child: Container(
          padding: const EdgeInsets.all(T.s12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(T.rCard),
            border: Border.all(color: c.outline),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: c.tint,
                  borderRadius: BorderRadius.circular(T.rButton),
                  border: Border.all(color: c.outline),
                ),
                alignment: Alignment.center,
                child: Text(
                  row.initials,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: c.primary,
                  ),
                ),
              ),
              const SizedBox(width: T.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      row.fullName,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [
                        if (row.employeeNo != null) row.employeeNo!,
                        if (row.jobTitle != null && row.jobTitle!.isNotEmpty)
                          row.jobTitle!,
                        if (row.department != null && row.department!.isNotEmpty)
                          row.department!,
                      ].join(' · '),
                      style: TextStyle(fontSize: 11.5, color: c.muted),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: T.s8),
              StatusChip(label: s.status(row.status), color: statusColor),
            ],
          ),
        ),
      ),
    );
  }
}
