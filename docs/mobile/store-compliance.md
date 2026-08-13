# Store Compliance — Google Play & Apple App Store

Working checklist for the HRMS staff app. Items marked **[build]** are baked into
the code as it is written; **[ops]** are account/console/legal tasks that cannot be
solved in code.

---

## 0. The decision that comes before everything: which channel?

This app is used **only by Riyada staff**. Both stores treat that case specially, and
publishing it as a normal public app is the single biggest rejection risk:

| Store | Public listing | Correct channel for an internal app |
|---|---|---|
| **Apple** | Guideline **4.2.x / 3.2.1**: apps for a single company's employees are routinely rejected from the public App Store | **Custom App via Apple Business Manager** (private distribution to your org), or Apple Developer **Enterprise Program** (in-house, no store at all) |
| **Google** | Allowed, but a login-walled app with no public value attracts review friction | **Managed Google Play — private app** (visible only to your Workspace org) |

**Recommendation: private distribution on both.** It removes the "minimum functionality
for the general public" problem entirely, skips content rating and most listing assets,
and keeps an internal HR tool off a public index. Public listing is only worth it if
Riyada intends to sell this product to other companies.

Everything below still applies to private distribution *except* the public listing
assets (§6), which get lighter.

---

## 1. Authentication & review access **[ops]**

- The app has **no self-registration** — accounts are provisioned by an ADMIN. Apple
  review will hit a login wall and reject unless you supply working credentials.
- Provide in App Store Connect → *App Review Information*: a **demo account** on a
  staging environment with representative (fake) data, plus notes explaining the roles.
- Google Play → *App access* → declare "All or some functionality is restricted" and
  supply the same credentials.
- The demo account must stay alive for the life of the listing, and its data must be
  fake — never point review at production employee records.

## 2. Privacy policy & data disclosure **[ops + build]**

- **[ops]** A publicly reachable **privacy policy URL** is mandatory on both stores and
  must be linked in the listing *and* reachable from inside the app.
- **[build]** In-app **Privacy & data** screen: policy link, support contact, and how to
  request data deletion.
- **[ops]** **Play Data Safety** form and **Apple Privacy Nutrition Label** must both
  declare what this app actually handles:

| Data | Collected | Purpose | Shared with third party |
|---|---|---|---|
| Name, employee number, job title | Yes | App functionality | No |
| Email, phone | Yes | App functionality | No |
| **National ID / Iqama** | Yes | App functionality (HR records) | **Yes — AI extraction** |
| Salary / settlement figures | Yes | App functionality | **Yes — AI letter drafting** (unless redacted) |
| Identity document images | Yes | App functionality | **Yes — AI extraction** |
| Crash / diagnostics | Optional | Diagnostics | Only if a crash SDK is added |

> ⚠️ The AI features send personal data to Anthropic's API. This **must** be declared as
> third-party sharing on both stores. Undisclosed sharing is a removal-level violation,
> and separately it is the open PDPL question from the scalability audit. If the answer
> is "we can't disclose that", the fix is to ship with `AI_REDACT_PII=true` and drop the
> camera-extraction feature from v1.

## 3. Account deletion **[build + ops]**

- Apple 5.1.1(v) requires in-app account deletion **for apps that let users create
  accounts**. This app does not — accounts are employer-provisioned, which is the
  recognised exemption. Do not add self-service deletion; an employee deleting their own
  HR record would be a data-integrity disaster.
- **[build]** Instead: the Privacy & data screen states plainly that accounts are managed
  by the employer, and gives the route to request deletion (HR contact + support email).
- **[ops]** Google Play's *Data deletion* field: supply a URL describing that same route.

## 4. Permissions — ask honestly, ask late **[build]**

| Permission | Where | Purpose string |
|---|---|---|
| Camera | `NSCameraUsageDescription` / `android.permission.CAMERA` | "Used to photograph employee documents so their number and expiry date can be captured." |
| Face ID / biometrics | `NSFaceIDUsageDescription` | "Used to unlock the app and confirm access to salary information." |
| Notifications | iOS prompt / Android 13+ `POST_NOTIFICATIONS` | Requested on first visit to Inbox, not at launch. |
| Photo library | only if attaching existing files | "Used to attach an existing document to an employee file." |

Rules: **no permission is requested at launch** — each is asked in context, at the moment
it is needed, after a short in-app explanation. Missing or boilerplate purpose strings are
an automatic Apple rejection.

## 5. Security & transport **[build]**

- **HTTPS only in release.** `android:usesCleartextTraffic="false"`, no ATS exceptions.
  The dev override for `http://localhost` is confined to the debug build via a network
  security config + `--dart-define`, never shipped.
- **Encryption declaration**: `ITSAppUsesNonExemptEncryption = false` in `Info.plist`
  (standard HTTPS only) — otherwise every submission stalls on an export-compliance form.
- **Certificate pinning** on the production host.
- **No secrets in the binary.** API base URL is configuration; there is no API key in the
  app — the AI key lives server-side and must stay there.
- Tokens in Keychain / EncryptedSharedPreferences, never in plain preferences.
- `FLAG_SECURE` on salary and settlement screens (permitted, common in finance apps).

## 6. Build & listing assets **[build + ops]**

- **[build]** Android: **App Bundle (.aab)**, `targetSdk` within one year of the current
  Play requirement, release signing via a keystore that is **not** in git, versionCode
  monotonic. iOS: bitcode off (modern Xcode), valid bundle id, provisioning profiles.
- **[build]** Adaptive icon (Android), full icon set (iOS), splash, correct app display
  name in Arabic and English.
- **[ops]** Screenshots per required device size, short/full description, support URL,
  content/age rating questionnaire (private distribution reduces this).
- **[build]** No placeholder text, no dead links, no visible debug UI, no crash on a cold
  start with no network — the reviewer will try exactly that.

## 7. Content & functionality traps **[build]**

- **Apple 4.2 minimum functionality**: a thin wrapper around a website is rejected. This
  app is native Flutter with offline caching and camera capture — safe, but never
  implement a screen as an embedded web view of the Vue app.
- **iOS 2.5.6**: no arbitrary code download; Flutter is fine, but do not add remote
  script execution.
- **Sign in with Apple** is required only when third-party social login is offered. This
  app uses employer email/password, so it does not apply.
- The app must be **usable on iPad** if published for iPhone without an iPad-only flag,
  and must handle rotation and large text without breaking.
- Arabic RTL must be correct throughout — a reviewer in an RTL locale seeing a broken
  layout is a legitimate rejection under 4.0 (design).

## 8. Pre-submission smoke list **[build]**

1. Cold start with airplane mode → useful offline state, no crash.
2. Login failure → clear message, no stack trace.
3. Deny every permission → app still works, features degrade with an explanation.
4. Force-kill during upload → no corrupt state.
5. Dark mode and 200% text on the five main screens.
6. Arabic and English, both directions, on the smallest supported device.
7. Token expiry mid-session → silent refresh, no logout loop.

---

## Owner split

| Area | Owner |
|---|---|
| Everything marked **[build]** | This implementation |
| Privacy policy text, PDPL/AI disclosure sign-off | Riyada legal / HR |
| Developer accounts, signing certs, ABM / managed Play setup | Riyada IT |
| Demo account + staging data for review | HR + this implementation |

---

# Action plan

Account setup is the long pole — weeks, not days — and it blocks release while
blocking nothing in development. Start items **A1 and B1 now**; the app can be
finished in parallel.

## Question 0 — answer this first, it removes work

**How many staff use iPhone?**

- **None** → skip the entire Apple track (A1–A4). Android can be distributed
  straight through MDM or a signed download, with no store, no review, no fee.
  This is the fastest possible path to staff having the app.
- **Some** → the Apple track is unavoidable. Apple offers no legitimate
  sideloading in Saudi Arabia, so any iPhone user forces items A1–A4.

**Question 0b:** will this app ever be sold to other companies? If no, everything
below assumes private distribution.

## Track A — Apple (only if iPhones are in scope)

| # | Task | Owner | Cost | Lead time | Blocks |
|---|---|---|---|---|---|
| A1 | **D-U-N-S number** for the legal entity | IT / Finance | free | **1–3 weeks** | A2 — start first |
| A2 | Apple Developer Program, *organization* enrolment | IT | ~$99/yr | days after A1 | A3, A4 |
| A3 | Apple Business Manager account, linked to A2 | IT | free | days | custom-app distribution |
| A4 | iOS signing certificates + provisioning profiles | IT | — | hours | any build |

Distribution: **Custom App via Apple Business Manager** — private to Riyada,
still reviewed but exempt from the "no public value" rejection that kills
internal apps on the public store.

## Track B — Android

| # | Task | Owner | Cost | Lead time | Blocks |
|---|---|---|---|---|---|
| B1 | Google Play Console account, *organization* type | IT | ~$25 once | days | B3 |
| B2 | **Release keystore** generated and stored in the company vault | IT | — | hours | every release |
| B3 | Managed Google Play private app (needs Google Workspace) — **or skip** and distribute via MDM | IT | free | days | — |

⚠️ **B2 is the item that bites years later.** Lose the keystore and the app can
never be updated under the same identity again. It must live in a permanent,
backed-up secret store and must never enter git.

## Track C — legal & content (needed for either store)

| # | Task | Owner | Lead time | Blocks |
|---|---|---|---|---|
| C1 | **Privacy policy** written and published at a public URL | Legal / HR | 1–2 weeks | submission on both stores |
| C2 | **AI / PDPL decision**: disclose the national-ID + salary sharing with Anthropic, or ship v1 with those features disabled | Legal | 1–2 weeks | data-safety forms, camera feature |
| C3 | Data-deletion route documented (employer-managed accounts → HR contact) | HR | days | Play data-deletion field |
| C4 | Play **Data Safety** form + Apple **Privacy Nutrition Label** filled from §2 | IT + this implementation | days | submission |
| C5 | **Demo account** on staging with fake data, for App Review | HR + implementation | days | Apple review |

## Track D — in the app (this implementation)

| # | Task | State |
|---|---|---|
| D1 | Cleartext blocked except loopback; backups + device transfer excluded | **done** |
| D2 | iOS purpose strings + encryption declaration | **done** |
| D3 | No install-time permissions beyond internet | **done** |
| D4 | Riyada icons, splash, bilingual app name | pending brand assets |
| D5 | In-app **Privacy & data** screen (policy, support, deletion route) | pending C1/C3 |
| D6 | Signing config reading an external keystore, never committed | pending B2 |
| D7 | Final bundle id (`com.riyada.hr`), version scheme | pending |
| D8 | Staging flavour for the review build | pending C5 |
| D9 | Pre-submission smoke list (§8) executed on a real device | pending a device |

## This week

1. **IT:** start the D-U-N-S lookup (A1) — free, longest lead time, blocks the whole Apple track.
2. **HR/Legal:** commission the privacy policy (C1) and settle the AI question (C2).
3. **Anyone:** count the iPhone users — that single number decides whether Track A is needed at all.
