import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/i18n/strings.dart';
import '../../app/shell.dart';
import '../../app/theme/tokens.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets/states.dart';
import '../auth/auth_controller.dart';
import '../work/work_providers.dart';
import 'home_models.dart';

final dashboardProvider = FutureProvider.autoDispose<DashboardData>((ref) async {
  final api = ref.watch(apiClientProvider);
  final json = await api.get<Map<String, dynamic>>('/api/dashboard');
  return DashboardData.fromJson(json);
});

final expiryProvider = FutureProvider.autoDispose<ExpiryBuckets>((ref) async {
  final api = ref.watch(apiClientProvider);
  final json = await api.get<Map<String, dynamic>>('/api/reports/summary');
  return ExpiryBuckets.fromJson(
    (json['expiringDocuments'] as Map<dynamic, dynamic>? ?? const {})
        .cast<String, dynamic>(),
  );
});

/// Plate 03 — the HR/ADMIN dashboard. One chart, three numbers, and the
/// work: every figure on this screen is tappable into the thing it counts,
/// because a number you cannot act on is decoration.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final c = context.c;
    final user = ref.watch(authControllerProvider).user;
    final dash = ref.watch(dashboardProvider);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: T.s16,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              s.dateLine(DateTime.now()),
              style: const TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.3,
              ),
            ),
            if (user != null)
              Text(
                '${user.name} · ${user.role}',
                style: TextStyle(fontSize: 12, color: c.muted),
              ),
          ],
        ),
      ),
      body: dash.when(
        loading: () => const ListSkeleton(itemHeight: 130, count: 3),
        error: (e, _) => ErrorStateView(
          message: e is ApiException && e.code == 'OFFLINE'
              ? s.offline
              : s.somethingWrong,
          retryLabel: s.retry,
          onRetry: () => ref.invalidate(dashboardProvider),
        ),
        data: (d) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(expiryProvider);
            ref.invalidate(workQueueProvider);
            ref.invalidate(dashboardProvider);
            await ref.read(dashboardProvider.future);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(T.s16, T.s12, T.s16, T.s24),
            children: [
              const _SlaStrip(),
              const SizedBox(height: T.s12),
              _PipelineCard(data: d),
              const SizedBox(height: T.s12),
              const _ExpiryCard(),
              const SizedBox(height: T.s12),
              _ActivityCard(items: d.recent),
            ],
          ),
        ),
      ),
    );
  }
}

/// Overdue / due today / this week, straight from the Work queue counts.
/// Tapping a tile opens Work pre-filtered on that bucket.
class _SlaStrip extends ConsumerWidget {
  const _SlaStrip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final c = context.c;
    final counts = ref.watch(workQueueProvider).maybeWhen(
          data: (q) => q.counts,
          orElse: () => null,
        );

    void openWork(String? bucket) {
      ref.read(workFilterProvider.notifier).state = bucket;
      final tabs =
          ref.read(authControllerProvider).capabilities?.tabs ?? const [];
      final i = tabs.indexOf('work');
      if (i >= 0) ref.read(shellIndexProvider.notifier).state = i;
    }

    Widget tile(String label, int? n, Color color, String? bucket) => Expanded(
          child: GestureDetector(
            onTap: () => openWork(bucket),
            child: Container(
              padding: const EdgeInsets.all(T.s12),
              decoration: BoxDecoration(
                color: c.surface,
                borderRadius: BorderRadius.circular(13),
                border: Border.all(color: c.outline),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    n?.toString() ?? '—',
                    style: TextStyle(
                      fontSize: 23,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.6,
                      color: (n ?? 0) > 0 ? color : c.ink,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(label, style: TextStyle(fontSize: 10.5, color: c.muted)),
                ],
              ),
            ),
          ),
        );

    return Row(
      children: [
        tile(s.bucketOverdue, counts?.overdue, c.danger, 'overdue'),
        const SizedBox(width: T.s8),
        tile(s.bucketToday, counts?.today, c.warning, 'today'),
        const SizedBox(width: T.s8),
        tile(s.bucketWeek, counts?.week, c.primary, 'week'),
      ],
    );
  }
}

const _pipelineOrder = [
  'CREATED',
  'AWAITING_FORM',
  'FORM_RECEIVED',
  'CONTRACT_CREATION',
  'AWAITING_CONTRACT_APPROVAL',
  'EXPIRED',
];

class _PipelineCard extends StatelessWidget {
  const _PipelineCard({required this.data});

  final DashboardData data;

  Color _segment(BuildContext context, String status) {
    final c = context.c;
    return switch (status) {
      'CREATED' => c.muted.withValues(alpha: 0.45),
      'AWAITING_FORM' => c.primary,
      'FORM_RECEIVED' => c.secondary,
      'EXPIRED' => c.danger,
      _ => c.warning, // both contract stages
    };
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final entries = _pipelineOrder
        .where((k) => (data.onboarding[k] ?? 0) > 0)
        .map((k) => (k, data.onboarding[k]!))
        .toList();

    return SectionCard(
      title: s.pipelineTitle,
      trailing: Text(
        s.nActive(data.pipelineTotal),
        style: TextStyle(fontSize: 11.5, color: c.primary, fontWeight: FontWeight.w600),
      ),
      child: entries.isEmpty
          ? Text(s.pipelineEmpty, style: TextStyle(fontSize: 12, color: c.muted))
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(T.rChip),
                  child: Row(
                    children: [
                      for (final (status, count) in entries)
                        Expanded(
                          flex: count,
                          child: Container(
                            height: 8,
                            margin: const EdgeInsetsDirectional.only(end: 2),
                            color: _segment(context, status),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: T.s12),
                Wrap(
                  spacing: T.s16,
                  runSpacing: T.s8,
                  children: [
                    for (final (status, count) in entries)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 7,
                            height: 7,
                            decoration: BoxDecoration(
                              color: _segment(context, status),
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            '${s.status(status)} · $count',
                            style: TextStyle(fontSize: 11, color: c.muted),
                          ),
                        ],
                      ),
                  ],
                ),
              ],
            ),
    );
  }
}

class _ExpiryCard extends ConsumerWidget {
  const _ExpiryCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final c = context.c;
    final buckets = ref.watch(expiryProvider);

    return SectionCard(
      title: s.expiryTitle,
      child: buckets.when(
        loading: () => const SizedBox(
          height: 60,
          child: Center(
            child: SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
        ),
        // The dashboard stays useful without this card's data.
        error: (_, _) =>
            Text(s.somethingWrong, style: TextStyle(fontSize: 12, color: c.muted)),
        data: (b) {
          Widget bar(String label, int value, Color color) => Padding(
                padding: const EdgeInsets.only(bottom: T.s8),
                child: Row(
                  children: [
                    SizedBox(
                      width: 76,
                      child: Text(label,
                          style: TextStyle(fontSize: 11.5, color: c.muted)),
                    ),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(T.rChip),
                        child: LinearProgressIndicator(
                          value: value / b.max,
                          minHeight: 6,
                          backgroundColor: c.outline,
                          valueColor: AlwaysStoppedAnimation(color),
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 30,
                      child: Text(
                        '$value',
                        textAlign: TextAlign.end,
                        style: const TextStyle(
                            fontSize: 11.5, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              );

          return Column(
            children: [
              bar(s.expiryExpired, b.expired, c.danger),
              bar(s.expiryWithin(30), b.in30, c.warning),
              bar(s.expiryWithin(60), b.in60, c.primary),
              bar(s.expiryWithin(90), b.in90, c.muted.withValues(alpha: 0.6)),
            ],
          );
        },
      ),
    );
  }
}

class _ActivityCard extends StatelessWidget {
  const _ActivityCard({required this.items});

  final List<ActivityItem> items;

  Color _dot(BuildContext context, ActivityItem item) {
    final c = context.c;
    final a = item.action;
    if (a.contains('EXPIRE') || a == 'DELETE') return c.danger;
    if (a.startsWith('SLA')) return c.warning;
    if (a == 'ACTIVATED' || a.contains('APPROVE') || a == 'COMPLETE') {
      return c.success;
    }
    return c.primary;
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;

    return SectionCard(
      title: s.recentActivity,
      child: items.isEmpty
          ? Text(s.noActivity, style: TextStyle(fontSize: 12, color: c.muted))
          : Column(
              children: [
                for (final item in items.take(8))
                  Padding(
                    padding: const EdgeInsets.only(bottom: T.s8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          margin: const EdgeInsetsDirectional.only(
                              top: 5, end: T.s8),
                          decoration: BoxDecoration(
                            color: _dot(context, item),
                            shape: BoxShape.circle,
                          ),
                        ),
                        Expanded(
                          child: Text(
                            [
                              if (item.subject != null) item.subject!,
                              s.auditAction(item.action),
                            ].join(' — '),
                            style: const TextStyle(fontSize: 12, height: 1.4),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: T.s8),
                        Text(
                          s.relativeTime(item.at),
                          style: TextStyle(fontSize: 10, color: c.muted),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}
