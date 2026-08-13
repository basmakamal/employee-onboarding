/// The employee file as GET /api/employees/:id returns it. Only the parts
/// the mobile overview shows are modelled — the tabs will add their own.
class EmployeeDetail {
  const EmployeeDetail({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.status,
    required this.availableActions,
    required this.processActions,
    required this.processes,
    this.employeeNo,
    this.department,
    this.jobTitle,
    this.project,
    this.email,
    this.phone,
    this.employmentType,
    this.hireDate,
  });

  final String id;
  final String firstName;
  final String lastName;
  final String status;
  final String? employeeNo;
  final String? department;
  final String? jobTitle;
  final String? project;
  final String? email;
  final String? phone;
  final String? employmentType;
  final DateTime? hireDate;

  /// Onboarding pipeline transitions the server says this actor may take.
  final List<String> availableActions;

  /// gosi | medical | criminal → the actions allowed on each right now.
  final Map<String, List<String>> processActions;

  /// The three Stage-2 tracks, when they exist (they open on activation).
  final List<ProcessTrack> processes;

  String get fullName => '$firstName $lastName'.trim();

  factory EmployeeDetail.fromJson(Map<String, dynamic> json) {
    List<String> actions(dynamic v) =>
        (v as List<dynamic>? ?? const []).map((e) => e as String).toList();

    final rawProcessActions =
        (json['processActions'] as Map<dynamic, dynamic>? ?? const {});
    final processActions = rawProcessActions.map(
      (k, v) => MapEntry(k as String, actions(v)),
    );

    final tracks = <ProcessTrack>[];
    void addTrack(String key, String? status, String? holdReason) {
      if (status == null) return;
      tracks.add(
        ProcessTrack(
          key: key,
          status: status,
          holdReason: holdReason,
          actions: processActions[key] ?? const [],
        ),
      );
    }

    Map<String, dynamic>? sub(String name) =>
        (json[name] as Map<dynamic, dynamic>?)?.cast<String, dynamic>();

    final gosi = sub('gosi');
    final medical = sub('medical');
    final criminal = sub('criminalRecord');
    addTrack('gosi', gosi?['status'] as String?, gosi?['holdReason'] as String?);
    addTrack('medical', medical?['status'] as String?,
        medical?['holdReason'] as String?);
    addTrack('criminal', criminal?['status'] as String?, null);

    final hire = json['hireDate'] as String?;

    return EmployeeDetail(
      id: json['id'] as String,
      firstName: json['firstName'] as String? ?? '',
      lastName: json['lastName'] as String? ?? '',
      status: json['status'] as String? ?? '',
      employeeNo: json['employeeNo'] as String?,
      department: json['department'] as String?,
      jobTitle: json['jobTitle'] as String?,
      project: json['project'] as String?,
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      employmentType: json['employmentType'] as String?,
      hireDate: hire == null ? null : DateTime.tryParse(hire),
      availableActions: actions(json['availableActions']),
      processActions: processActions,
      processes: tracks,
    );
  }
}

class ProcessTrack {
  const ProcessTrack({
    required this.key,
    required this.status,
    required this.actions,
    this.holdReason,
  });

  /// gosi | medical | criminal — the path segment the API expects.
  final String key;
  final String status;
  final String? holdReason;
  final List<String> actions;
}
