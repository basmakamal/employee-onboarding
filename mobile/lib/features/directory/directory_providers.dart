import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import 'directory_models.dart';

/// Search text, debounced by the screen before it lands here.
final directoryQueryProvider = StateProvider<String>((ref) => '');

/// Lifecycle filter: all | onboarding | active | inactive.
final directoryFilterProvider = StateProvider<String>((ref) => 'all');

const _pageSize = 20;

/// Paginated employee list. Pages accumulate for infinite scroll; changing
/// the query or filter resets the list — the server does the searching, the
/// client only asks.
class DirectoryController extends StateNotifier<AsyncValue<List<EmployeeRow>>> {
  DirectoryController(this._ref) : super(const AsyncValue.loading()) {
    _load(reset: true);
  }

  final Ref _ref;
  int _page = 1;
  int _total = 0;
  bool _loadingMore = false;

  bool get hasMore => state.value != null && state.value!.length < _total;

  Future<void> refresh() => _load(reset: true);

  Future<void> loadMore() async {
    if (_loadingMore || !hasMore) return;
    _loadingMore = true;
    _page += 1;
    await _load();
    _loadingMore = false;
  }

  Future<void> _load({bool reset = false}) async {
    if (reset) {
      _page = 1;
      state = const AsyncValue.loading();
    }
    final api = _ref.read(apiClientProvider);
    final q = _ref.read(directoryQueryProvider);
    final filter = _ref.read(directoryFilterProvider);
    try {
      final json = await api.get<Map<String, dynamic>>(
        '/api/employees',
        query: {
          if (q.trim().isNotEmpty) 'q': q.trim(),
          if (filter != 'all') 'filter': filter,
          'page': _page,
          'limit': _pageSize,
        },
      );
      final page = EmployeePage.fromJson(json, _page);
      _total = page.total;
      final existing = reset ? <EmployeeRow>[] : (state.value ?? <EmployeeRow>[]);
      state = AsyncValue.data([...existing, ...page.items]);
    } catch (e, st) {
      if (reset) {
        state = AsyncValue.error(e, st);
      } else {
        _page -= 1; // keep what we have; the next scroll can retry
      }
    }
  }
}

final directoryControllerProvider = StateNotifierProvider.autoDispose<
    DirectoryController, AsyncValue<List<EmployeeRow>>>((ref) {
  // Re-create (and therefore reload) whenever the query or filter changes.
  ref.watch(directoryQueryProvider);
  ref.watch(directoryFilterProvider);
  return DirectoryController(ref);
});
