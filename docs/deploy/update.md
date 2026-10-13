# Updating the server — every release

Run as the app user. All commands are copy-paste; each block stops at the first failure.

## 0. Before (30 seconds)

```bash
sudo -iu onboarding bash -c 'mysqldump --single-transaction employee_onboarding > ~/before-$(date +%F-%H%M).sql && cd /var/www/RiyadaOnboarding && git log -1 --oneline'
```

Keeps a database dump next to the app user's home and prints what is currently deployed.

## 1. Pull, build, migrate, restart

```bash
sudo -iu onboarding bash -c 'cd /var/www/RiyadaOnboarding && git pull && cd backend && npm ci && npx prisma generate && npx prisma migrate deploy && npm run build && cd ../frontend && npm ci && npm run build && pm2 restart onboarding-api onboarding-worker'
```

What each step is for: `git pull` (new code) → `npm ci` (exact dependencies) → `prisma generate` (typed client for the current schema) → `prisma migrate deploy` (apply any new SQL migrations, in order, once) → `npm run build` (compile) → frontend build (what Apache serves) → PM2 restart.

**Never run this as root or your own user** — `git` refuses ("dubious ownership") and `npm` would leave root-owned files the app cannot write.

## 2. Seed rules, teams, roles, list defaults (safe on a live database)

```bash
sudo -iu onboarding bash -c 'cd /var/www/RiyadaOnboarding/backend && npx prisma db seed -- --rules-only'
```

Creates whatever is missing (SLA rules, responsible teams, system roles + permissions, dropdown defaults) and never overwrites an admin's edits or demo accounts. Run it after every update; it is idempotent.

## 3. One-off: multi-company legacy mapping (first deploy of Phase 2 only)

Dry run — prints what it would create/assign and lists anything it cannot resolve; writes nothing:

```bash
sudo -iu onboarding bash -c 'cd /var/www/RiyadaOnboarding/backend && npx tsx scripts/migrate-multi-company.ts --code RIYADA --name-ar ريادة --name-en Riyada'
```

Review the output, then apply (one transaction, audited, report saved under `backend/storage/migration-reports/`):

```bash
sudo -iu onboarding bash -c 'cd /var/www/RiyadaOnboarding/backend && npx tsx scripts/migrate-multi-company.ts --code RIYADA --name-ar ريادة --name-en Riyada --apply'
```

Re-running later is harmless (it reports "nothing to do").

## 4. Check

```bash
sudo -iu onboarding pm2 ls && curl -s http://127.0.0.1:4000/api/ready && curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"nobody@example.com","password":"wrong"}'
```

Expected: both PM2 processes `online`, `{"status":"ready","checks":{"db":"up"}}`, and `401` (a `500` means the API cannot reach MySQL or Redis — see step 5).

## 5. If something is wrong

| Symptom | Where to look | Fix |
|---|---|---|
| Login returns 500 | `sudo -iu onboarding pm2 logs onboarding-api --lines 100 --nostream` | `NOAUTH` → put the Redis password in `backend/.env` as `REDIS_URL=redis://:PASSWORD@127.0.0.1:6379`; a Prisma/column error → `npx prisma migrate status` then `migrate deploy` |
| Pages 404 / old UI | `ls /var/www/RiyadaOnboarding/frontend/dist` | the frontend build failed — rerun step 1 and read the error |
| Migration failed half-way | `npx prisma migrate status` | fix the cause, `migrate deploy` again; each migration folder has a `ROLLBACK.md` when reverting is needed |
| Roll back the code | `git log --oneline -5` → `git checkout <previous-sha>` as `onboarding`, then step 1 without `git pull` | restore the dump from step 0 only if a migration must be undone |

## Branch note

The server tracks `main`. Merge the PRs you want on the server first, then run step 1. Feature branches are never pulled on the server.
