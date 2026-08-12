import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/storage/secure_store.dart';

class SessionUser {
  const SessionUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
  });

  final String id;
  final String name;
  final String email;
  final String role;

  factory SessionUser.fromJson(Map<String, dynamic> json) => SessionUser(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        email: json['email'] as String? ?? '',
        role: json['role'] as String? ?? '',
      );
}

/// What the app may show this session — straight from /api/me/capabilities,
/// so navigation follows the server's answer and never a client-side rule.
class Capabilities {
  const Capabilities({
    required this.role,
    required this.tabs,
    required this.modules,
  });

  final String role;
  final List<String> tabs;
  final Map<String, String> modules;

  factory Capabilities.fromJson(Map<String, dynamic> json) => Capabilities(
        role: json['role'] as String? ?? '',
        tabs: (json['tabs'] as List<dynamic>? ?? const [])
            .map((e) => e as String)
            .toList(),
        modules: (json['modules'] as Map<dynamic, dynamic>? ?? const {})
            .map((k, v) => MapEntry(k as String, v as String)),
      );

  bool can(String module) => (modules[module] ?? 'none') != 'none';
}

@immutable
class AuthState {
  const AuthState({
    this.user,
    this.capabilities,
    this.restoring = true,
    this.busy = false,
    this.error,
  });

  final SessionUser? user;
  final Capabilities? capabilities;

  /// True until the stored refresh token has been tried once at launch.
  final bool restoring;
  final bool busy;
  final String? error;

  bool get signedIn => user != null;

  AuthState copyWith({
    SessionUser? user,
    Capabilities? capabilities,
    bool? restoring,
    bool? busy,
    String? error,
    bool clearUser = false,
    bool clearError = false,
  }) {
    return AuthState(
      user: clearUser ? null : (user ?? this.user),
      capabilities: clearUser ? null : (capabilities ?? this.capabilities),
      restoring: restoring ?? this.restoring,
      busy: busy ?? this.busy,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._api) : super(const AuthState()) {
    // The client tells us when a refresh finally fails, so a dead session
    // drops to the login screen instead of failing every request silently.
    _api.onSessionLost = onSessionLost;
    unawaited(restore());
  }

  final ApiClient _api;

  /// Launch path: try the stored refresh token so a returning user lands on
  /// their queue rather than a login form.
  Future<void> restore() async {
    // Launch must never die here: a locked keystore or a wiped credential is
    // a "please sign in", not a crash on a cold start.
    String? stored;
    try {
      stored = await _api.store.readRefreshToken();
    } catch (_) {
      stored = null;
    }
    if (stored == null) {
      state = state.copyWith(restoring: false);
      return;
    }
    try {
      final body = await _api.post<Map<String, dynamic>>(
        '/api/auth/refresh',
        body: {'refreshToken': stored},
      );
      await _adopt(body);
    } catch (_) {
      await _api.store.clear().catchError((_) {});
      state = const AuthState(restoring: false);
      return;
    }
    state = state.copyWith(restoring: false);
  }

  Future<bool> signIn(String email, String password) async {
    state = state.copyWith(busy: true, clearError: true);
    try {
      final body = await _api.post<Map<String, dynamic>>(
        '/api/auth/login',
        body: {'email': email.trim(), 'password': password},
      );
      await _adopt(body);
      state = state.copyWith(busy: false, restoring: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, error: e.message, restoring: false);
      return false;
    }
  }

  Future<void> signOut() async {
    final refresh = await _api.store.readRefreshToken();
    try {
      await _api.post<dynamic>(
        '/api/auth/logout',
        body: {'refreshToken': refresh},
      );
    } on ApiException {
      // Signing out locally must succeed even when the server cannot be told.
    }
    await _api.store.clear();
    _api.accessToken = null;
    state = const AuthState(restoring: false);
  }

  /// Called when a refresh finally fails mid-session.
  void onSessionLost() {
    _api.accessToken = null;
    state = const AuthState(restoring: false);
  }

  Future<void> _adopt(Map<String, dynamic> body) async {
    _api.accessToken = body['accessToken'] as String?;
    final refresh = body['refreshToken'] as String?;
    if (refresh != null) await _api.store.saveRefreshToken(refresh);
    final user = SessionUser.fromJson(
      (body['user'] as Map<dynamic, dynamic>? ?? const {})
          .cast<String, dynamic>(),
    );
    final caps = await _api.get<Map<String, dynamic>>('/api/me/capabilities');
    state = state.copyWith(
      user: user,
      capabilities: Capabilities.fromJson(caps),
      clearError: true,
    );
  }
}

// ── providers ───────────────────────────────────────────────────────────────

final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(store: ref.watch(secureStoreProvider)),
);

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(ref.watch(apiClientProvider));
});
