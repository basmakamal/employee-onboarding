/// A row of GET /api/employees — the list payload, not the full file.
class EmployeeRow {
  const EmployeeRow({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.status,
    this.employeeNo,
    this.department,
    this.jobTitle,
    this.email,
  });

  final String id;
  final String firstName;
  final String lastName;
  final String status;
  final String? employeeNo;
  final String? department;
  final String? jobTitle;
  final String? email;

  String get fullName => '$firstName $lastName'.trim();

  /// Two-glyph monogram; one for single-word names. Takes whole code points
  /// so a name is never sliced through a surrogate pair.
  String get initials {
    final parts =
        fullName.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '—';
    String first(String word) => String.fromCharCode(word.runes.first);
    if (parts.length == 1) return first(parts.first);
    return '${first(parts.first)}${first(parts.last)}';
  }

  factory EmployeeRow.fromJson(Map<String, dynamic> json) => EmployeeRow(
        id: json['id'] as String,
        firstName: json['firstName'] as String? ?? '',
        lastName: json['lastName'] as String? ?? '',
        status: json['status'] as String? ?? '',
        employeeNo: json['employeeNo'] as String?,
        department: json['department'] as String?,
        jobTitle: json['jobTitle'] as String?,
        email: json['email'] as String?,
      );
}

class EmployeePage {
  const EmployeePage({
    required this.items,
    required this.total,
    required this.page,
  });

  final List<EmployeeRow> items;
  final int total;
  final int page;

  bool get hasMore => items.length < total;

  factory EmployeePage.fromJson(Map<String, dynamic> json, int page) =>
      EmployeePage(
        items: (json['items'] as List<dynamic>? ?? const [])
            .map((e) => EmployeeRow.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
        total: (json['total'] as num?)?.toInt() ?? 0,
        page: page,
      );
}
