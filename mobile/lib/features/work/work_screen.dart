import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/i18n/strings.dart';
import '../../app/theme/tokens.dart';
import '../../core/network/api_client.dart';
import '../auth/auth_controller.dart';
import '../employee/employee_screen.dart';
import 'work_models.dart';
import 'work_providers.dart';

/// Plate 04 — the queue of records this role can act on right now, grouped by
/// SLA pressure. The screen with no web equivalent, and the reason the app
/// exists.
class WorkScreen extends ConsumerWidget {
  const WorkScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final c = context.c;
    final queue = ref.watch(workQueueProvider);
    final filter = ref.watch(workFilterProvider);
    final role = ref.watch(authControllerProvider).capabilities?.role ?? '';

    return Scaffold(
      appBar: AppBar(
        titleSpacing: T.s16,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              s.work,
              style: const TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.4,
              ),
            ),
            Text(
              queue.maybeWhen(
                data: (q) => '$role · ${s.recordsNeedYou(q.counts.total)}',
                orElse: () => role,
              ),
              style: TextStyle(fontSize: 12, color: c.muted),
            ),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(46),
          child: queue.maybeWhen(
            data: (q) => _Filters(counts: q.counts, selected: filter),
            orElse: () => const SizedBox(height: 46),
          ),
        ),
      ),
      body: queue.when(
        loading: () => const _QueueSkeleton(),
        error: (e, _) => _ErrorState(
          message: e is ApiException && e.code == 'OFFLINE'
              ? s.offline
              : s.somethingWrong,
          onRetry: () => ref.invalidate(workQueueProvider),
        ),
        data: (q) {
          if (q.items.isEmpty) return _EmptyState(title: s.queueEmpty, hint: s.queueEmptyHint);
          final groups = q.grouped;
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(workQueueProvider.future),
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(T.s16, T.s12, T.s16, T.s24),
              itemCount: groups.length,
              itemBuilder: (context, index) {
                final bucket = groups.keys.elementAt(index);
                final rows = groups[bucket]!;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _GroupHeader(bucket: bucket, count: rows.length),
                    for (final item in rows) ...[
                      InkWell(
                        borderRadius: BorderRadius.circular(T.rCard),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) =>
                                EmployeeScreen(employeeId: item.employeeId),
                          ),
                        ),
                        child: _WorkCard(item: item),
                      ),
                      const SizedBox(height: T.s8),
                    ],
                    const SizedBox(height: T.s8),
                  ],
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _Filters extends ConsumerWidget {
  const _Filters({required this.counts, required this.selected});

  final WorkCounts counts;
  final String? selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final entries = <(String?, String, int)>[
      (null, s.all, counts.total),
      ('overdue', s.bucketOverdue, counts.overdue),
      ('today', s.bucketToday, counts.today),
      ('week', s.bucketWeek, counts.week),
    ];

    return SizedBox(
      height: 46,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(T.s16, 0, T.s16, T.s12),
        itemCount: entries.length,
        separatorBuilder: (_, _) => const SizedBox(width: T.s8),
        itemBuilder: (context, i) {
          final (value, label, count) = entries[i];
          final on = selected == value;
          final c = context.c;
          return GestureDetector(
            onTap: () => ref.read(workFilterProvider.notifier).state = value,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: on ? c.primary : Colors.transparent,
                borderRadius: BorderRadius.circular(T.rChip),
                border: Border.all(color: on ? c.primary : c.outline),
              ),
              alignment: Alignment.center,
              child: Text(
                '$label $count',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: on
                      ? Theme.of(context).colorScheme.onPrimary
                      : c.muted,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({required this.bucket, required this.count});

  final String bucket;
  final int count;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final label = switch (bucket) {
      'overdue' => s.bucketOverdue,
      'today' => s.bucketToday,
      'week' => s.bucketWeek,
      _ => s.bucketLater,
    };
    final color = bucket == 'overdue' ? c.danger : c.muted;

    return Padding(
      padding: const EdgeInsets.only(top: T.s8, bottom: T.s12),
      child: Row(
        children: [
          Text(
            '${label.toUpperCase()} · $count',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
              color: color,
            ),
          ),
          const SizedBox(width: T.s8),
          Expanded(child: Container(height: 1, color: c.outline)),
        ],
      ),
    );
  }
}

/// One record: severity stripe, who, which machine, why it is stuck, how long.
class _WorkCard extends StatelessWidget {
  const _WorkCard({required this.item});

  final WorkItem item;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final stripe = switch (item.bucket) {
      'overdue' => c.danger,
      'today' => c.warning,
      _ => c.primary,
    };
    final statusColor = c.forStatus(item.status);

    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(T.rCard),
        border: Border.all(color: c.outline),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              width: 3,
              margin: const EdgeInsets.symmetric(
                vertical: T.s12,
                horizontal: T.s12,
              ),
              decoration: BoxDecoration(
                color: stripe,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(0, T.s12, T.s12, T.s12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            item.employeeName,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              letterSpacing: -0.1,
                            ),
                          ),
                        ),
                        if (item.employeeNo != null)
                          Text(
                            item.employeeNo!,
                            style: TextStyle(
                              fontSize: 11,
                              color: c.muted,
                              fontFeatures: const [FontFeature.tabularFigures()],
                            ),
                            textDirection: TextDirection.ltr,
                          ),
                      ],
                    ),
                    const SizedBox(height: T.s8),
                    Row(
                      children: [
                        _Chip(label: s.status(item.status), color: statusColor),
                        const SizedBox(width: T.s8),
                        Flexible(
                          child: Text(
                            s.kind(item.kind),
                            style: TextStyle(fontSize: 12, color: c.muted),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    if (item.detail != null && item.detail!.isNotEmpty) ...[
                      const SizedBox(height: T.s8),
                      Text(
                        s.holdReason(item.detail!),
                        style: TextStyle(fontSize: 12, color: c.muted),
                      ),
                    ],
                    const SizedBox(height: T.s12),
                    Container(height: 1, color: c.outline),
                    const SizedBox(height: T.s8),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.bucket == 'overdue'
                                ? s.ageDays(item.ageDays)
                                : (item.dueInDays != null
                                    ? s.dueInDays(item.dueInDays!)
                                    : s.ageDays(item.ageDays)),
                            style: TextStyle(
                              fontSize: 11.5,
                              color: item.bucket == 'overdue'
                                  ? c.danger
                                  : c.muted,
                              fontWeight: item.bucket == 'overdue'
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                            ),
                          ),
                        ),
                        // Actions land here in M3, rendered from the record's
                        // availableActions — never from a client-side rule.
                        Icon(Icons.chevron_right, size: 18, color: c.muted),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(T.rChip),
        border: Border.all(color: color),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}

class _QueueSkeleton extends StatelessWidget {
  const _QueueSkeleton();

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return ListView.separated(
      padding: const EdgeInsets.all(T.s16),
      itemCount: 4,
      separatorBuilder: (_, _) => const SizedBox(height: T.s8),
      itemBuilder: (_, _) => Container(
        height: 108,
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(T.rCard),
          border: Border.all(color: c.outline),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.title, required this.hint});

  final String title;
  final String hint;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(T.s32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle_outline, size: 44, color: c.success),
            const SizedBox(height: T.s16),
            Text(
              title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: T.s4),
            Text(
              hint,
              style: TextStyle(fontSize: 13, color: c.muted),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final s = S.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(T.s32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_outlined, size: 40, color: c.muted),
            const SizedBox(height: T.s16),
            Text(message, style: const TextStyle(fontSize: 15)),
            const SizedBox(height: T.s16),
            OutlinedButton(onPressed: onRetry, child: Text(s.retry)),
          ],
        ),
      ),
    );
  }
}

