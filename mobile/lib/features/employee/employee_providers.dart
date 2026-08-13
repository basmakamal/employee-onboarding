import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../work/work_providers.dart';
import 'employee_models.dart';

final employeeDetailProvider =
    FutureProvider.autoDispose.family<EmployeeDetail, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final json = await api.get<Map<String, dynamic>>('/api/employees/$id');
  return EmployeeDetail.fromJson(json);
});

/// Runs a state transition and re-reads the record.
///
/// Deliberately no optimistic update: the server's guarded transition can
/// refuse (someone else moved the record first), and showing a change that
/// did not happen is worse than a half-second wait.
class EmployeeActions {
  EmployeeActions(this._ref);

  final Ref _ref;

  Future<void> pipeline(String employeeId, String action) async {
    final api = _ref.read(apiClientProvider);
    await api.post<dynamic>(
      '/api/employees/$employeeId/actions/${_slug(action)}',
      body: const <String, dynamic>{},
    );
    _invalidate(employeeId);
  }

  Future<void> process(
    String employeeId,
    String kind,
    String action, {
    String? holdReason,
    String? holdNote,
  }) async {
    final api = _ref.read(apiClientProvider);
    await api.post<dynamic>(
      '/api/employees/$employeeId/processes/$kind/actions/${action.toLowerCase()}',
      body: {
        'holdReason': ?holdReason,
        if (holdNote != null && holdNote.isNotEmpty) 'holdNote': holdNote,
      },
    );
    _invalidate(employeeId);
  }

  void _invalidate(String employeeId) {
    _ref.invalidate(employeeDetailProvider(employeeId));
    _ref.invalidate(workQueueProvider);
  }

  /// SEND_CONTRACT → send-contract, matching the route table.
  static String _slug(String action) =>
      action.toLowerCase().replaceAll('_', '-');
}

final employeeActionsProvider =
    Provider<EmployeeActions>((ref) => EmployeeActions(ref));
