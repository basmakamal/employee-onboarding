/// Only what the Home screen renders — the endpoints return more.
class DashboardData {
  const DashboardData({
    required this.onboarding,
    required this.recent,
  });

  /// Pipeline status → count (ACTIVE/INACTIVE live elsewhere).
  final Map<String, int> onboarding;
  final List<ActivityItem> recent;

  int get pipelineTotal =>
      onboarding.values.fold(0, (sum, count) => sum + count);

  factory DashboardData.fromJson(Map<String, dynamic> json) => DashboardData(
        onboarding: (json['onboarding'] as Map<dynamic, dynamic>? ?? const {})
            .map((k, v) => MapEntry(k as String, (v as num).toInt())),
        recent: (json['recent'] as List<dynamic>? ?? const [])
            .map((e) => ActivityItem.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
      );
}

class ActivityItem {
  const ActivityItem({
    required this.id,
    required this.action,
    required this.at,
    this.subject,
    this.toStatus,
  });

  final String id;
  final String action;
  final DateTime at;
  final String? subject;
  final String? toStatus;

  factory ActivityItem.fromJson(Map<String, dynamic> json) => ActivityItem(
        id: json['id'] as String,
        action: json['action'] as String? ?? '',
        at: DateTime.tryParse(json['at'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        subject: json['subject'] as String?,
        toStatus: json['toStatus'] as String?,
      );
}

/// The document-expiry buckets from /api/reports/summary.
class ExpiryBuckets {
  const ExpiryBuckets({
    required this.expired,
    required this.in30,
    required this.in60,
    required this.in90,
  });

  final int expired;
  final int in30;
  final int in60;
  final int in90;

  int get max => [expired, in30, in60, in90]
      .fold(1, (m, v) => v > m ? v : m); // 1 floor avoids divide-by-zero

  factory ExpiryBuckets.fromJson(Map<String, dynamic> json) => ExpiryBuckets(
        expired: (json['expired'] as num?)?.toInt() ?? 0,
        in30: (json['in30'] as num?)?.toInt() ?? 0,
        in60: (json['in60'] as num?)?.toInt() ?? 0,
        in90: (json['in90'] as num?)?.toInt() ?? 0,
      );
}
