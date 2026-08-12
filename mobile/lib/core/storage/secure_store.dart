import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The only place a credential touches disk: Keychain on iOS, EncryptedShared-
/// Preferences on Android. The access token is deliberately NOT stored — it
/// lives in memory for its 15 minutes and is re-minted from the refresh token.
class SecureStore {
  /// Defaults are the hardened ones in this version of the plugin: Keychain
  /// on iOS, encrypted storage on Android. Do not swap in plain preferences.
  SecureStore([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _refreshKey = 'refresh_token';

  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  Future<void> saveRefreshToken(String token) =>
      _storage.write(key: _refreshKey, value: token);

  Future<void> clear() => _storage.delete(key: _refreshKey);
}
