# Riyada HR System — Onboarding, Employee File & Offboarding

A bilingual (العربية / English) HR workflow system covering the full employee
lifecycle: **trainee intake → data form → contract → employee file (GOSI,
medical insurance, criminal record, asset custody, HR requests) → offboarding &
final settlement**. Every step is an explicit **state machine** with an
**SLA / reminder engine**, **bilingual e-mail notifications**, **role-based
access**, and an **append-only audit trail**.

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/API-Express_4-000000?logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/ORM-Prisma_7-2D3748?logo=prisma&logoColor=white)
![MySQL](https://img.shields.io/badge/DB-MySQL%20%2F%20MariaDB-4479A1?logo=mysql&logoColor=white)
![Vue](https://img.shields.io/badge/Frontend-Vue_3_%2B_Vuetify_3-42B883?logo=vue.js&logoColor=white)
![CI](https://github.com/basmakamal/employee-onboarding/actions/workflows/ci.yml/badge.svg)

---

## Contents

1. [Tech stack](#1-tech-stack)
2. [Project structure](#2-project-structure)
3. [Getting started (download & install)](#3-getting-started-download--install)
4. [Configuration (`.env`)](#4-configuration-env)
5. [Everyday commands](#5-everyday-commands)
6. [API map](#6-api-map)
7. [What the system does (the three stages)](#7-what-the-system-does-the-three-stages)
8. [Architecture](#8-architecture)
9. [Access model](#9-access-model)
10. [Testing & CI](#10-testing--ci)
11. [Branching & releases](#11-branching--releases)
12. [Deployment](#12-deployment)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Tech stack

| Layer | Technology | Why it is here |
|---|---|---|
| **Runtime** | Node.js ≥ 20 (CI runs 22), TypeScript 5.7, ES modules | One language front and back; strict typing catches mistakes before runtime. |
| **API** | Express 4, Zod (validation), Helmet, express-rate-limit, pino (logging) | Small, well-known HTTP layer. Every request body is validated with Zod before it reaches business code. |
| **Database** | MySQL / MariaDB via **Prisma 7** (`@prisma/adapter-mariadb`) | Prisma generates a typed client from `schema.prisma`; migrations are versioned SQL files. XAMPP's MariaDB works out of the box. |
| **Auth** | JSON Web Tokens (access + refresh), bcrypt password hashes, signed single-purpose link tokens | Staff log in; trainees / employees never have accounts — they receive expiring signed links by e-mail. |
| **Background work** | BullMQ + Redis (**optional**) | When `REDIS_URL` is set, e-mail goes through a queue and the SLA engine runs in a separate worker process. Without Redis everything runs in-process. |
| **E-mail** | Nodemailer (Office 365 / any SMTP), bilingual HTML templates | `NOTIFIER=console` in development prints mail to the terminal instead of sending. |
| **Files** | Multer → local disk (`backend/storage`, outside the web root) | Uploads are MIME-whitelisted, size-limited, renamed to random UUIDs, sharded per employee. |
| **Reports** | ExcelJS | Excel exports on the Reports page. |
| **AI (optional)** | `@anthropic-ai/sdk` | Letter drafting and the assistant page — disabled until `ANTHROPIC_API_KEY` is set. PII is redacted by default. |
| **Frontend** | Vue 3 (Composition API), Vuetify 3, Pinia, Vue Router, vue-i18n, Vite 6, Lucide icons, Sass | Arabic (RTL) is the default locale, English second; light/dark theme persisted per user. |
| **Quality** | Vitest + Supertest, ESLint, Prettier, vue-tsc, GitHub Actions | 30 test files / ~250 tests on the backend; typecheck + build on the frontend. |
| **Optional infra** | Docker Compose (MariaDB 10.6 on port 3307, Redis 7) | For machines without XAMPP. |

---

## 2. Project structure

```
employee-onboarding/
├── backend/                      # Express + Prisma API (port 4000)
│   ├── prisma/
│   │   ├── schema.prisma         # the data model — single source of truth for tables
│   │   ├── migrations/           # versioned SQL, applied with `prisma migrate deploy`
│   │   └── seed.ts               # staff accounts, SLA rules, holidays, list values
│   ├── prisma.config.ts          # Prisma 7 config (datasource URL, seed command)
│   ├── scripts/                  # one-off maintenance: migrate-storage, run-retention
│   ├── src/
│   │   ├── index.ts              # boots the API: wires routers, health checks, SSE
│   │   ├── worker.ts             # queue worker (mail + SLA engine) when Redis is on
│   │   ├── app.ts                # Express app factory (middleware, rate limits, error handler)
│   │   ├── container.ts          # dependency wiring: repositories → services
│   │   ├── auth/                 # login/refresh, users, link tokens, requireAuth/requireRole
│   │   ├── common/               # config (env schema), prisma client, storage, http helpers, queue
│   │   ├── workflow/             # the state-machine engine, machines/, SLA scheduler,
│   │   │                         #   working days + Saudi holidays, audit log, ownership
│   │   ├── modules/
│   │   │   ├── employees/        # employee file, onboarding pipeline, data form, contract,
│   │   │   │                     #   HR requests (+ documents), expiry-tracked documents
│   │   │   ├── processes/        # GOSI, medical insurance, criminal record
│   │   │   ├── assets/           # asset registry + custody forms (e-approval by link)
│   │   │   ├── offboarding/      # termination flow, asset-return gate, settlement
│   │   │   ├── dashboard/        # home-page numbers
│   │   │   ├── reports/          # Excel exports
│   │   │   ├── lists/            # editable dropdown values (departments, titles…)
│   │   │   └── settings/         # SLA rules, holidays, ownership, e-mail settings
│   │   ├── notifications/        # templates (ar/en), notifier strategies, e-mail log, SSE bell
│   │   ├── events/               # in-process event bus
│   │   ├── ai/                   # Claude-backed letter drafting / assistant
│   │   └── generated/prisma/     # generated Prisma client (gitignored — run `prisma generate`)
│   ├── tests/                    # Vitest unit + HTTP tests (fake repositories, Supertest)
│   ├── storage/                  # uploaded files in development (gitignored)
│   └── .env.example              # copy to .env
│
├── frontend/                     # Vue 3 + Vuetify SPA (port 3000, proxies /api → 4000)
│   └── src/
│       ├── main.ts / App.vue     # app shell, theme, locale bootstrap
│       ├── router/               # routes + auth guards
│       ├── stores/               # Pinia: auth session, lists, notifications
│       ├── api/                  # fetch wrapper with silent token refresh
│       ├── i18n/locales/         # ar.json (default, RTL) and en.json
│       ├── pages/                # one file per screen (Employees, EmployeeDetail, Offboarding,
│       │   └── public/           #   Reports, Settings, Users…) — public/ = signed-link pages
│       ├── components/           # shared UI: StatusChip, EntityCard, ConfirmDialog, bell…
│       ├── composables/          # reusable logic (notify, confirm, lists…)
│       ├── plugins/              # Vuetify setup, icon registry (Lucide)
│       └── styles/               # design tokens, RTL helpers
│
├── docs/
│   └── deploy/production.md      # step-by-step Ubuntu + Apache + PM2 deployment
├── docker-compose.yml            # optional MariaDB (3307) + Redis (6379)
├── start-dev.bat                 # Windows: opens API, worker and UI in three terminals
└── .github/workflows/ci.yml      # lint · typecheck · test · build on every push/PR
```

**How a request travels:** `route` (Zod-validated) → `service` (business rules,
state-machine guard, audit row — all in one DB transaction) → `repository`
(the only place Prisma is called) → MySQL. E-mails and file writes happen
*outside* the transaction so an SMTP hiccup never rolls back a saved record.

---

## 3. Getting started (download & install)

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | 20 or newer (22 recommended) | <https://nodejs.org> — comes with `npm`. Check: `node -v`. |
| **Git** | any recent | <https://git-scm.com> |
| **MySQL / MariaDB** | MariaDB 10.4+ or MySQL 8 | Easiest on Windows: **XAMPP** — start *MySQL* from the control panel. Alternative: `docker compose up -d db` (MariaDB on port **3307**). |
| **Redis** | 7 (optional) | Only for the mail queue / worker mode. `docker compose up -d redis` or skip entirely. |

### Step 1 — download the code

```bash
git clone https://github.com/basmakamal/employee-onboarding.git
cd employee-onboarding
```

### Step 2 — create the database

Create an empty database named `employee_onboarding` (phpMyAdmin → *New*, or):

```bash
mysql -u root -p -e "CREATE DATABASE employee_onboarding CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### Step 3 — backend (API)

```bash
cd backend
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
```

Open `.env` and check `DATABASE_URL`. The default is XAMPP's root user with no
password on **127.0.0.1** (see [Troubleshooting](#13-troubleshooting) for why
not `localhost`):

```
DATABASE_URL=mysql://root:@127.0.0.1:3306/employee_onboarding
```

For Docker's MariaDB use `mysql://root:root@127.0.0.1:3307/employee_onboarding`.
Also set the two JWT secrets to any long random strings.

Then install, create the tables, seed, and run:

```bash
npm install
npx prisma generate           # builds the typed client into src/generated (gitignored)
npx prisma migrate deploy     # applies every migration in prisma/migrations
npx prisma db seed            # staff accounts, SLA rules, Saudi holidays, dropdown lists
npm run dev                   # API → http://localhost:4000
```

Sanity checks:

```bash
curl http://localhost:4000/api/health     # {"status":"ok"}
curl http://localhost:4000/api/ready      # {"checks":{"db":"up", ...}}
```

### Step 4 — frontend (UI)

In a second terminal:

```bash
cd frontend
npm install
npm run dev                   # UI → http://localhost:3000
```

Vite serves the SPA on **:3000** and proxies every `/api/*` call to the API on
**:4000**, so the browser only ever talks to one origin — no CORS setup needed.

### Step 5 — log in

Open <http://localhost:3000> and sign in with one of the seeded development accounts
(password for all: **`Passw0rd!`**):

| E-mail | Role | Sees / owns |
|---|---|---|
| `admin@example.com` | ADMIN | Everything, plus *Staff & roles*, *Settings*, *Automation*, *Lists* |
| `hr@example.com` | HR | Employees, onboarding pipeline, requests, offboarding |
| `insurance@example.com` | INSURANCE | GOSI + medical insurance cards |
| `it@example.com` | IT | Asset registry + custody forms |
| `finance@example.com` | FINANCE | Settlement approval & file closure |

> Change these passwords (Admin → *Staff & roles*) before any real deployment.
> The seed never overwrites an existing password.

### Optional — queue / worker mode

Set `REDIS_URL=redis://127.0.0.1:6379` in `backend/.env` and run a third terminal:

```bash
cd backend && npm run worker
```

E-mail then goes through a BullMQ queue and the SLA engine runs in the worker.
On Windows, `start-dev.bat` at the repo root opens API + worker + UI together.

### Sending real e-mail

Development defaults to `NOTIFIER=console` (mail is printed, not sent). To send,
set `NOTIFIER=smtp` plus `SMTP_HOST/PORT/USER/PASS` and `MAIL_FROM` — or leave the
`.env` alone and configure SMTP at runtime from the admin **Settings → E-mail**
page (the password is stored AES-256-GCM encrypted).

---

## 4. Configuration (`.env`)

All variables are validated at boot by `backend/src/common/config.ts`; the API
refuses to start and lists what is wrong if something is missing.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `4000` | API port |
| `DATABASE_URL` | — **required** | `mysql://user:pass@127.0.0.1:3306/employee_onboarding` |
| `JWT_ACCESS_SECRET` | — **required** (≥ 8 chars) | Signs short-lived access tokens |
| `JWT_REFRESH_SECRET` | — **required** (≥ 8 chars) | Signs refresh tokens (cookie) |
| `APP_URL` | `http://localhost:3000` | Public URL of the UI — signed links in e-mails point here |
| `UPLOAD_DIR` | `./storage` | Where uploaded files are written (keep outside the web root) |
| `LINK_TTL_HOURS` | `240` | Lifetime of signed links (10 days) |
| `SLA_TICK_MINUTES` | `5` | How often the SLA engine scans rules; `0` disables it |
| `SLA_BATCH_SIZE` | `500` | Max records one rule handles per tick |
| `NOTIFIER` | `console` | `console` (print) or `smtp` (send) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | — | Required together when `NOTIFIER=smtp` |
| `REDIS_URL` | — (off) | Enables the mail queue, worker-run SLA engine, revocable refresh tokens |
| `ANTHROPIC_API_KEY` | — (off) | Enables AI letter drafting / assistant |
| `AI_MODEL` | `claude-opus-5` | Model used for AI features |
| `AI_REDACT_PII` | `true` | Strip national IDs before anything is sent to the AI API |

The frontend needs no `.env`; it reads everything from the API.

---

## 5. Everyday commands

**Backend** (`cd backend`)

| Command | What it does |
|---|---|
| `npm run dev` | API with hot reload (`tsx watch`) |
| `npm run worker` | Queue worker (needs `REDIS_URL`) |
| `npm test` | Vitest — unit + HTTP tests, no database needed |
| `npm run typecheck` / `npm run lint` / `npm run format` | TypeScript · ESLint · Prettier |
| `npm run build` → `npm start` | Compile to `dist/` and run in production |
| `npx prisma migrate dev --name <what-changed>` | After editing `schema.prisma`: write a new migration and apply it locally |
| `npx prisma migrate deploy` | Apply pending migrations (servers, CI) |
| `npx prisma db seed` | Dev seed (staff + rules + lists) |
| `npx prisma db seed -- --rules-only` | **Live databases**: rules, holidays and lists only — no demo accounts |
| `npx prisma studio` | Browse the database in a web UI |
| `npm run retention` | Purge expired link tokens / old firings per the retention policy |
| `npm run migrate:storage` | One-off: re-shard old flat uploads into per-employee folders |

**Frontend** (`cd frontend`)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :3000 with `/api` proxy |
| `npm run typecheck` | `vue-tsc --noEmit` |
| `npm run build` → `npm run preview` | Production bundle in `dist/`, served locally for a check |

---

## 6. API map

All staff endpoints live under `/api` and require a Bearer access token (the UI
handles refresh silently). Signed-link endpoints (`/api/link/*`) and the public
list endpoint are rate-limited and need no login.

| Prefix | Area | Highlights |
|---|---|---|
| `POST /api/auth/*` | Login, refresh, logout, change password | JWT access + refresh cookie |
| `/api/link/*` | **Signed-link pages** (no account) | Data form, contract view, asset-custody approval, exit interview |
| `/api/public/lists` | Dropdown values for the public data form | |
| `/api/employees` | Employee file | List/search (paged), create (onboarding or direct), profile, photo, audit timeline, **onboarding actions** (`send-form`, `resend-form`, `request-missing`, `accept-documents`, `reopen`), withdraw, contract + status + file, **HR requests** (+ one document each), process cards (`gosi` / `medical` / `criminal`) with certificate upload |
| `/api/employees/:id/documents`, `/api/employee-documents` | Expiry-tracked documents (Iqama, passport…) | Renewal clears past alerts |
| `/api/assets`, `/api/asset-forms` | Asset registry + custody forms | Draft → sent → approved by the employee via link |
| `/api/offboardings` | Stage 3 | Request → procedures → asset return gate → notice → settlement → close |
| `/api/notifications` | In-app bell, SSE stream, e-mail log (`/log`) | |
| `/api/dashboard` | Home-page summary | |
| `/api/reports/*` | Excel exports | |
| `/api/settings/*` | SLA rules, holidays, status ownership, responsibility, e-mail settings | ADMIN |
| `/api/email-templates`, `/api/email-triggers` | Editable bilingual templates, memo triggers (who gets which notice) | |
| `/api/users` | Staff accounts & roles, invitations | ADMIN |
| `/api/lists` | Editable dropdown lists | |
| `/api/ai/*` | Letter drafting, assistant | Off without `ANTHROPIC_API_KEY` |
| `GET /api/health`, `GET /api/ready`, `GET /api/admin/health` | Liveness · DB readiness · full snapshot (DB, Redis, queues, disk) | |

Errors are always `{ "error": { "code": "...", "message": "..." } }` — e.g.
`WRONG_STATUS`, `DOCUMENTS_INCOMPLETE`, `FILE_MISSING`, `NOT_FOUND`.

---

## 7. What the system does (the three stages)

Based on the company BRD (Arabic, three stages). Every status change below is
audited, and the SLA table drives the reminders — nothing is hardcoded.

### Stage 1 — Trainee → employee (إدارة المتدرب)

```mermaid
stateDiagram-v2
    [*] --> CREATED : HR creates the record
    CREATED --> AWAITING_FORM : data form sent (signed link) — can be re-sent
    AWAITING_FORM --> FORM_RECEIVED : trainee submits form + documents
    FORM_RECEIVED --> AWAITING_FORM : something missing → back to trainee with a note
    FORM_RECEIVED --> CONTRACT_CREATION : data & documents complete
    CONTRACT_CREATION --> AWAITING_CONTRACT_APPROVAL : HR records "submitted" on the contracting platform
    AWAITING_CONTRACT_APPROVAL --> ACTIVE : HR records "active" → employee number allocated, Stage 2 opens
    AWAITING_CONTRACT_APPROVAL --> CONTRACT_CREATION : rejected → fix and resubmit
    AWAITING_FORM --> EXPIRED : deadline passed
    AWAITING_CONTRACT_APPROVAL --> EXPIRED : deadline passed
    EXPIRED --> AWAITING_CONTRACT_APPROVAL : HR reopens
    CREATED --> WITHDRAWN : trainee withdraws (any pre-active status)
```

The contract itself is created and approved on an **external contracting
platform**; HR records its status here (pending / active / rejected / expired).
Recording *active* is the conversion: employee number allocated, the four
Stage-2 tracks opened. A trainee can be **withdrawn** at any point before that —
every open link, custody form and process card is stopped, nothing is deleted.

| Status | After | System action |
|---|---|---|
| Awaiting form | 24 h | Reminder → trainee + HR |
| Awaiting form | 10 calendar days | → `EXPIRED`, notify HR |
| Contract creation | 2 working days | Reminder → HR |
| Awaiting contract approval | 5 working days | Daily reminder → new hire + HR |
| Awaiting contract approval | 10 calendar days | → `EXPIRED`, notify HR |

Working days exclude Friday, Saturday and the holidays table (Saudi public
holidays seeded, editable in Settings).

### Stage 2 — Employee file (ملف الموظف)

Opens automatically when the contract becomes active. The tracks are
**independent** — a delay in one never blocks another or the employee's work.

| Track | Statuses | Notes |
|---|---|---|
| **GOSI** (التأمينات) | Pending / Done / On hold / Cancelled | Hold reasons: optional subscription, government employee, DOB or ID mismatch, incomplete data, other |
| **Medical insurance** (التأمين الطبي) | Pending / Done / On hold / Cancelled | Hold reasons: Elm data issue, other insurance exists, declined, awaiting insurer, incomplete data, other |
| **Criminal record** (خلو السوابق) | Training / Request sent / Pending / Done | Certificate attached on completion |
| **Asset custody** (العهد) | Draft / Sent / Pending employee approval / Approved / Rejected / Cancelled | Unlimited asset lines; the employee e-approves via signed link |
| **HR requests** (الطلبات والخدمات) | Salary letter, IBAN letter, department / title change, promotion, project transfer, warning, investigation | One document per request, grouped by type on the profile |
| **Expiry documents** | Iqama, passport, national ID, contract, permits | Alerts before expiry; renewal resets the alert cycle |

### Stage 3 — Offboarding (إنهاء العلاقة التعاقدية)

```mermaid
stateDiagram-v2
    [*] --> REQUESTED : termination request + reason
    REQUESTED --> IN_PROGRESS : procedures (exit-interview link if resignation)
    IN_PROGRESS --> ASSETS_PENDING : verify every custody item is returned
    ASSETS_PENDING --> NOTICE_SENT : termination notice (approved template)
    NOTICE_SENT --> SETTLEMENT : HR enters final settlement → approval
    SETTLEMENT --> CLOSED : paid → employee INACTIVE, file closed
    CLOSED --> [*]
```

Reasons: resignation · termination · contract expiry · retirement · death. The
exit interview is sent **only for resignations**. Asset return is a hard gate.
Settlement amounts are **entered by HR** (no automatic payroll calculation).

---

## 8. Architecture

```
Vue 3 + Vuetify  (RTL/LTR · ar/en · light/dark)
      │  /api — same origin (Vite proxy in dev, Apache reverse proxy in prod)
      ▼
Express route  →  Service  →  Repository (Prisma)  →  MySQL
 Zod validates     state machine + guards        the only Prisma caller
 roles checked     audit row in the SAME transaction
                    │
                    ├─▶ Notifications (bilingual templates → console / SMTP / BullMQ queue)
                    ├─▶ Signed links (LinkTokenService — only the hash is stored)
                    └─▶ Event bus → SSE bell in the UI

SLA scheduler (in-process, or in the worker with Redis):
  reads sla_rules → reminders, daily nags, auto-expiry — each firing audited & de-duplicated
```

Design rules the code follows:

- **Routes never contain business logic.** They validate, call one service method, shape the response.
- **Services own the state machines.** `workflow/engine.ts` checks the transition is legal for this actor and role, runs the guard (documents complete? asset returned? owner of this status?), moves the status with a *guarded update* (`where id + expected status`) so two people cannot move the same record twice, stamps `statusChangedAt` (the SLA anchor) and appends the audit row — all inside one transaction (`UnitOfWork`).
- **Repositories are the only Prisma callers**, one class per aggregate, constructor-injected so tests swap them for fakes.
- **Audit log is append-only** — the repository exposes no update or delete.
- **Side effects stay outside transactions.** E-mail, link issuance and file deletion run after commit; a failed write never leaves a row pointing at a deleted file.
- **Ownership** (who may act on a status) and **responsibility** (who is notified) are configured in Settings, not in code.

---

## 9. Access model

- **Staff** (`ADMIN`, `HR`, `INSURANCE`, `IT`, `FINANCE`): JWT login. `ADMIN` passes every role check. Role guards sit on routes *and* inside state-machine transitions.
- **Trainees / employees have no accounts.** Every action they take — data form, contract view, asset-custody approval, exit interview — arrives as a **signed, expiring, single-purpose link** by e-mail (`DATA_FORM`, `CONTRACT_APPROVAL`, `ASSET_APPROVAL`, `EXIT_INTERVIEW`). Issuing a new link kills the previous one; only the token hash is stored; links are rate-limited.
- Uploaded files are served only through authenticated endpoints; storage keys are validated so nothing can escape the upload root.

---

## 10. Testing & CI

```bash
cd backend && npm test              # Vitest: services with fake repositories, HTTP via Supertest
cd backend && npm run typecheck && npm run lint
cd frontend && npm run typecheck && npm run build
```

Tests need **no database** — repositories are replaced with in-memory fakes, and
the state machines are tested in isolation (`tests/machines.test.ts`,
`tests/engine.test.ts`). GitHub Actions (`.github/workflows/ci.yml`) runs
`prisma generate → lint → typecheck → test` for the backend and `build` for the
frontend on every push and pull request to `develop`, `staging` and `main`.

---

## 11. Branching & releases

```
feature/<topic>  ──PR──▶  develop  ──PR──▶  staging  ──PR──▶  main
   (daily work)          (integration)      (QA / test server)   (production)
```

Never commit directly to `develop`, `staging` or `main`. Commit messages follow
`type(scope): summary` (`feat(requests): …`, `fix(data-form): …`, `design: …`).

**After editing `schema.prisma`:** run `npx prisma migrate dev --name <change>`
locally and commit the generated folder under `prisma/migrations`. Servers apply
it with `npx prisma migrate deploy`.

---

## 12. Deployment

The full step-by-step guide for the production server (Ubuntu 22.04 · Apache 2.4
reverse proxy · MySQL 8 · Node 22 · Redis · PM2, dedicated unprivileged user) is
in [`docs/deploy/production.md`](docs/deploy/production.md). In short:

```bash
# on the server, inside the repo
cd backend  && npm ci && npx prisma generate && npx prisma migrate deploy && npm run build
npx prisma db seed -- --rules-only          # first time only: rules, holidays, lists
pm2 restart onboarding-api onboarding-worker
cd ../frontend && npm ci && npm run build   # Apache serves frontend/dist
```

`GET /api/admin/health` gives admins one snapshot of DB, Redis, queue depth,
disk usage and table growth.

---

## 13. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `connect ECONNREFUSED 127.0.0.1:3306` / `pool timeout` | MySQL is not running — start it from the XAMPP control panel (or `docker compose up -d db` and point `DATABASE_URL` at port 3307). `GET /api/ready` shows `db: down` in the same situation. |
| Access denied for `root` while XAMPP MySQL is clearly running | Use **`127.0.0.1`, not `localhost`**, in `DATABASE_URL`. On Windows `localhost` may resolve to IPv6 `::1`, where a *different* MySQL (another XAMPP / a CRM install) can be listening and reject the login. |
| `Cannot find module '../generated/prisma/client'` | Run `npx prisma generate` — the client is gitignored and must be built after `npm install` and after every schema change. |
| `Invalid environment configuration: …` at boot | A required `.env` value is missing or malformed; the message lists which. Copy `.env.example` again if unsure. |
| E-mails never arrive in development | Expected — `NOTIFIER=console` prints them to the API terminal. Look for the signed link there. |
| Migration says "drift detected" locally | The local DB was changed by hand. In development it is acceptable to `npx prisma migrate reset` (drops and re-creates everything, then seeds). |
| MySQL dies with *Incorrect file format 'db'* (XAMPP) | Restore `mysql/data/mysql/db.*` from `mysql/backup`, then start MySQL again. |

---

## License

MIT
