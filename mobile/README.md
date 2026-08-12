# Riyada HR — mobile app

Flutter client for the HRMS staff roles (HR, Insurance, IT, Finance, Admin).
Design: `docs/mobile/architecture.md` and `docs/mobile/screen-concepts.html`.
Store rules: `docs/mobile/store-compliance.md`.

## What exists today

| Piece | State |
|---|---|
| Design tokens + Material 3 theme (light/dark) | done — lifted from the web `vuetify.ts` |
| Bilingual strings, Arabic default, RTL primary | done |
| Dio client: bearer auth, single-flight refresh, typed errors | done |
| Secure token storage (Keychain / encrypted prefs) | done |
| Login screen | done |
| Role-computed bottom navigation | done — built from `GET /api/me/capabilities` |
| Work queue (Plate 04) | done — pressure grouping, severity stripes, status chips |
| Home, Directory, Inbox, More | placeholders |
| Per-record actions from `availableActions` | next |
| Push (FCM), camera capture, biometrics | later milestones |

## Running it

The app needs the backend on the same machine:

```bash
cd backend && npm run dev      # API on :4000
```

Then pick a target. **A device or emulator must be available** — this machine
currently has neither Android nor the Windows C++ toolchain set up:

```bash
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:4000
```

| Target | Requirement |
|---|---|
| Android emulator / device | Android Studio + SDK + an AVD (`flutter doctor` must show a green Android toolchain) |
| iOS simulator | macOS + Xcode — not possible on this machine |
| Windows desktop | Visual Studio with the "Desktop development with C++" workload |
| Chrome | works out of the box, but web is a **preview convenience only**, not a shipping target |

Android emulators reach the host API on `10.0.2.2`, not `localhost`:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000
```

Cleartext HTTP is allowed **only** for `localhost` / `10.0.2.2` (see
`android/app/src/main/res/xml/network_security_config.xml`). A release build
must be given an https URL:

```bash
flutter build appbundle --dart-define=API_BASE_URL=https://hr.riyada-ksa.com
```

## Checks

```bash
flutter analyze
flutter test
```

## Layout

```
lib/
├── app/          theme tokens, strings, the signed-in shell
├── core/         network client, secure storage
└── features/
    ├── auth/     session controller + login
    └── work/     the queue: models, providers, screen
```

State is Riverpod; the server is the authority. After any transition the
provider is invalidated and the record re-fetched rather than patched locally —
a guarded transition can be refused, and the UI must reflect what actually
happened.

## Rules this app follows

1. **No permission logic in the client.** Buttons come from the record's
   `availableActions`; navigation comes from `/api/me/capabilities`.
2. **No secrets in the binary.** The API base URL is configuration; the AI key
   lives server-side.
3. **Nothing invented on screen.** Every status, name and reason is a real
   value from the API — placeholders say so plainly.
