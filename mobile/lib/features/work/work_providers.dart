import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import 'work_models.dart';

/// Selected bucket filter — null means "everything".
final workFilterProvider = StateProvider<String?>((ref) => null);

/// The queue itself. Re-fetched rather than mutated after an action: the
/// server decides what is still work, so a transition invalidates this.
final workQueueProvider = FutureProvider.autoDispose<WorkQueue>((ref) async {
  final api = ref.watch(apiClientProvider);
  final bucket = ref.watch(workFilterProvider);
  final json = await api.get<Map<String, dynamic>>(
    '/api/work',
    query: {'bucket': ?bucket, 'limit': 50},
  );
  return WorkQueue.fromJson(json);
});
