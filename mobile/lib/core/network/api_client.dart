import 'dart:async';

import 'package:dio/dio.dart';

import '../storage/secure_store.dart';

/// Base URL is configuration, never a hardcoded production host:
///   flutter run --dart-define=API_BASE_URL=https://hr.riyada-ksa.com
/// The default points at a local dev API. Release builds must pass an https
/// URL — cleartext is blocked on both platforms (see the manifest / ATS).
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:4000',
);

/// A failed request, already turned into something a screen can show.
class ApiException implements Exception {
  ApiException(this.message, {this.code, this.status});

  final String message;
  final String? code;
  final int? status;

  bool get isAuthFailure => status == 401;

  @override
  String toString() => message;
}

/// Dio wrapper carrying the access token, refreshing it once on a 401, and
/// signalling the app when the session is genuinely gone.
///
/// Refresh is single-flight: a burst of parallel 401s produces one refresh
/// call, not one per request (the web client's known gap).
class ApiClient {
  ApiClient({required this.store, Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: apiBaseUrl,
                connectTimeout: const Duration(seconds: 15),
                receiveTimeout: const Duration(seconds: 30),
                headers: {'X-Client': 'mobile'},
              ),
            ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (accessToken != null) {
            options.headers['Authorization'] = 'Bearer $accessToken';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final isAuthCall =
              error.requestOptions.path.startsWith('/api/auth/');
          if (error.response?.statusCode != 401 || isAuthCall) {
            return handler.next(error);
          }
          final refreshed = await _refreshOnce();
          if (!refreshed) {
            onSessionLost?.call();
            return handler.next(error);
          }
          try {
            final retried = await _dio.fetch<dynamic>(
              error.requestOptions
                ..headers['Authorization'] = 'Bearer $accessToken',
            );
            return handler.resolve(retried);
          } on DioException catch (e) {
            return handler.next(e);
          }
        },
      ),
    );
  }

  final Dio _dio;
  final SecureStore store;

  /// Set by the auth controller once it exists — keeps the client free of any
  /// dependency on app state (and the providers free of a cycle).
  void Function()? onSessionLost;

  /// In memory only, for its 15-minute life — never written to disk.
  String? accessToken;
  Future<bool>? _inFlightRefresh;

  /// Exchange the stored refresh token for a new pair. Returns false when the
  /// session is over — a replayed or expired token gets 401 from the server,
  /// which is the single-use revocation working as designed.
  Future<bool> _refreshOnce() {
    return _inFlightRefresh ??= _doRefresh().whenComplete(() {
      _inFlightRefresh = null;
    });
  }

  Future<bool> _doRefresh() async {
    final refresh = await store.readRefreshToken();
    if (refresh == null) return false;
    try {
      final res = await _dio.post<Map<String, dynamic>>(
        '/api/auth/refresh',
        data: {'refreshToken': refresh},
      );
      final body = res.data ?? const {};
      accessToken = body['accessToken'] as String?;
      final next = body['refreshToken'] as String?;
      if (next != null) await store.saveRefreshToken(next);
      return accessToken != null;
    } on DioException {
      await store.clear();
      accessToken = null;
      return false;
    }
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) async {
    return _unwrap<T>(() => _dio.get<T>(path, queryParameters: query));
  }

  Future<T> post<T>(String path, {Object? body}) async {
    return _unwrap<T>(() => _dio.post<T>(path, data: body));
  }

  Future<T> _unwrap<T>(Future<Response<T>> Function() send) async {
    try {
      final res = await send();
      return res.data as T;
    } on DioException catch (e) {
      throw _toApiException(e);
    }
  }

  ApiException _toApiException(DioException e) {
    final status = e.response?.statusCode;
    final data = e.response?.data;
    if (data is Map && data['error'] is Map) {
      final err = data['error'] as Map;
      return ApiException(
        (err['message'] as String?) ?? 'Request failed',
        code: err['code'] as String?,
        status: status,
      );
    }
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout) {
      return ApiException('offline', code: 'OFFLINE', status: status);
    }
    return ApiException('Request failed', status: status);
  }
}

