/// Mirrors the WorkItem shape returned by GET /api/work.
class WorkItem {
  const WorkItem({
    required this.kind,
    required this.id,
    required this.employeeId,
    required this.employeeName,
    required this.employeeNo,
    required this.status,
    required this.detail,
    required this.ageDays,
    required this.dueInDays,
    required this.bucket,
  });

  final String kind;
  final String id;
  final String employeeId;
  final String employeeName;
  final String? employeeNo;
  final String status;
  final String? detail;
  final int ageDays;
  final int? dueInDays;
  final String bucket;

  factory WorkItem.fromJson(Map<String, dynamic> json) => WorkItem(
        kind: json['kind'] as String,
        id: json['id'] as String,
        employeeId: json['employeeId'] as String,
        employeeName: json['employeeName'] as String? ?? '—',
        employeeNo: json['employeeNo'] as String?,
        status: json['status'] as String,
        detail: json['detail'] as String?,
        ageDays: (json['ageDays'] as num?)?.toInt() ?? 0,
        dueInDays: (json['dueInDays'] as num?)?.toInt(),
        bucket: json['bucket'] as String? ?? 'later',
      );
}

class WorkCounts {
  const WorkCounts({
    required this.overdue,
    required this.today,
    required this.week,
    required this.later,
    required this.total,
  });

  final int overdue;
  final int today;
  final int week;
  final int later;
  final int total;

  static const empty =
      WorkCounts(overdue: 0, today: 0, week: 0, later: 0, total: 0);

  factory WorkCounts.fromJson(Map<String, dynamic> json) => WorkCounts(
        overdue: (json['overdue'] as num?)?.toInt() ?? 0,
        today: (json['today'] as num?)?.toInt() ?? 0,
        week: (json['week'] as num?)?.toInt() ?? 0,
        later: (json['later'] as num?)?.toInt() ?? 0,
        total: (json['total'] as num?)?.toInt() ?? 0,
      );
}

class WorkQueue {
  const WorkQueue({required this.items, required this.counts});

  final List<WorkItem> items;
  final WorkCounts counts;

  static const empty = WorkQueue(items: [], counts: WorkCounts.empty);

  factory WorkQueue.fromJson(Map<String, dynamic> json) => WorkQueue(
        items: (json['items'] as List<dynamic>? ?? const [])
            .map((e) => WorkItem.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
        counts: WorkCounts.fromJson(
          (json['counts'] as Map<dynamic, dynamic>? ?? const {})
              .cast<String, dynamic>(),
        ),
      );

  /// Items grouped in queue order, empty buckets dropped.
  Map<String, List<WorkItem>> get grouped {
    const order = ['overdue', 'today', 'week', 'later'];
    final map = <String, List<WorkItem>>{};
    for (final bucket in order) {
      final rows = items.where((i) => i.bucket == bucket).toList();
      if (rows.isNotEmpty) map[bucket] = rows;
    }
    return map;
  }
}
