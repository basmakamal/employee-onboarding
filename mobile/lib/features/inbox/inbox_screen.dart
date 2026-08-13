import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/i18n/strings.dart';
import '../../app/theme/tokens.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets/states.dart';
import '../auth/auth_controller.dart';
import '../employee/employee_screen.dart';

/// One in-app notification. `entity`/`entityId` are the deep-link anchor the
/// backend already stores on every row — no new API was needed for tapping
/// through to the record.
class InboxItem {
  const InboxItem({
    required this.id,
    required this.body,
    required this.createdAt,
    this.subject,
    this.readAt,
    this.entity,
    this.entityId,
  });

  final String id;
  final String body;
  final DateTime createdAt;
  final String? subject;
  final DateTime? readAt;
  final String? entity;
  final String? entityId;

  bool get unread => readAt == null;

  factory InboxItem.fromJson(Map<String, dynamic> json) => InboxItem(
        id: json['id'] as String,
        body: json['body'] as String? ?? '',
        subject: json['subject'] as String?,
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '') ??
                DateTime.fromMillisecondsSinceEpoch(0),
        readAt: json['readAt'] == null
            ? null
            : DateTime.tryParse(json['readAt'] as String),
        entity: json['entity'] as String?,
        entityId: json['entityId'] as String?,
      );
}

class InboxData {
  const InboxData({required this.items, required this.unread});

  final List<InboxItem> items;
  final int unread;
}

final inboxProvider = FutureProvider.autoDispose<InboxData>((ref) async {
  final api = ref.watch(apiClientProvider);
  final json = await api.get<Map<String, dynamic>>(
    '/api/notifications',
    query: {'limit': 50},
  );
  return InboxData(
    items: (json['items'] as List<dynamic>? ?? const [])
        .map((e) => InboxItem.fromJson((e as Map).cast<String, dynamic>()))
        .toList(),
    unread: (json['unread'] as num?)?.toInt() ?? 0,
  );
});

/// Plate 21 — the notification centre.
class InboxScreen extends ConsumerWidget {
  const InboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final data = ref.watch(inboxProvider);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: T.s16,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              s.tabInbox,
              style: const TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.4,
              ),
            ),
            Text(
              data.maybeWhen(
                data: (d) => s.unreadCount(d.unread),
                orElse: () => '',
              ),
              style: TextStyle(fontSize: 12, color: context.c.muted),
            ),
          ],
        ),
        actions: [
          data.maybeWhen(
            data: (d) => d.unread == 0
                ? const SizedBox.shrink()
                : TextButton(
                    onPressed: () async {
                      final api = ref.read(apiClientProvider);
                      try {
                        await api.post<dynamic>('/api/notifications/read-all');
                      } on ApiException {
                        // Nothing to undo; the next refresh shows the truth.
                      }
                      ref.invalidate(inboxProvider);
                    },
                    child: Text(s.markAllRead),
                  ),
            orElse: () => const SizedBox.shrink(),
          ),
          const SizedBox(width: T.s8),
        ],
      ),
      body: data.when(
        loading: () => const ListSkeleton(itemHeight: 78),
        error: (e, _) => ErrorStateView(
          message: e is ApiException && e.code == 'OFFLINE'
              ? s.offline
              : s.somethingWrong,
          retryLabel: s.retry,
          onRetry: () => ref.invalidate(inboxProvider),
        ),
        data: (d) {
          if (d.items.isEmpty) {
            return EmptyStateView(
              icon: Icons.notifications_none,
              title: s.inboxEmpty,
              hint: s.inboxEmptyHint,
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(inboxProvider.future),
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(T.s16, T.s12, T.s16, T.s24),
              itemCount: d.items.length,
              separatorBuilder: (_, _) => const SizedBox(height: T.s8),
              itemBuilder: (context, i) => _NotificationRow(item: d.items[i]),
            ),
          );
        },
      ),
    );
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({required this.item});

  final InboxItem item;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final s = S.of(context);
    // Only employee-anchored rows can be opened today; the rest still read
    // fine, they just do not navigate.
    final canOpen = item.entity == 'EMPLOYEE' && item.entityId != null;

    return Material(
      color: item.unread ? c.tint : c.surface,
      borderRadius: BorderRadius.circular(T.rCard),
      child: InkWell(
        borderRadius: BorderRadius.circular(T.rCard),
        onTap: canOpen
            ? () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => EmployeeScreen(employeeId: item.entityId!),
                  ),
                )
            : null,
        child: Container(
          padding: const EdgeInsets.all(T.s12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(T.rCard),
            border: Border.all(
              color: item.unread ? c.primary.withValues(alpha: 0.35) : c.outline,
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 3,
                height: 34,
                margin: const EdgeInsetsDirectional.only(end: T.s12),
                decoration: BoxDecoration(
                  color: item.unread ? c.primary : Colors.transparent,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.subject ?? '',
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      item.body,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: c.muted,
                        height: 1.45,
                      ),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: T.s8),
                    Text(
                      s.relativeTime(item.createdAt),
                      style: TextStyle(fontSize: 10, color: c.muted),
                    ),
                  ],
                ),
              ),
              if (canOpen)
                Icon(Icons.chevron_right, size: 18, color: c.muted),
            ],
          ),
        ),
      ),
    );
  }
}
