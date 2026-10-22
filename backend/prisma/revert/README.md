# Revert to the onboarding-only system

The code on `main` is back to commit `14d5703` (PR #66, 16 Sep 2026): the
employee onboarding system, without multi-company, shifts, attendance, leave,
compensation, loans, payroll, payslips or HR reports.

The full HR platform is kept in Git — tag `hr-platform-2026-10-22` and branch
`archive/hr-platform` — and can be brought back at any time.

A database that ran the HR platform has 17 extra migrations
(`20261013090000_multi_company_foundation` … `20261016120000_payroll_corrections`).
Prisma has no "down" migrations, so this folder undoes them:

| File | What it does | Changes data? |
|---|---|---|
| `db.mjs` | Runs `mysql` / `mysqldump` with the connection in `backend/.env` | — |
| `01-precheck.sql` | Shows the migrations applied, the main company, and anything that would block the revert | No |
| `02-revert-to-onboarding.sql` | Keeps the main company's lists, settings, templates, triggers, SLA rules and holidays; removes employee login accounts; drops every HR-platform table and column; forgets the 17 migrations | **Yes — HR data is deleted** |
| `03-decrypt-ibans.ts` | Turns encrypted IBANs (`enc:v1:…`) back into plain text | Yes (IBANs only) |

Tested on a copy of the development database: afterwards `prisma migrate diff`
finds no difference from the onboarding schema, `prisma migrate status` reports
it up to date, and the onboarding client reads every table.

## Run on the server

Run as the app user, one step at a time; check each result before the next.

```bash
sudo -iu onboarding
cd /var/www/RiyadaOnboarding/backend
```

1. **Stop the app** so nothing writes during the change:
   `pm2 stop onboarding-api onboarding-worker`
2. **Get the onboarding code** (only files change; the database is not touched):
   `cd .. && git fetch && git checkout main && git pull && cd backend`
3. **Back up the database** (keep this file — it is the only way back for the data):
   `node prisma/revert/db.mjs dump ~/backup-before-onboarding-revert-$(date +%F).sql`
4. **Pre-check:** `node prisma/revert/db.mjs sql prisma/revert/01-precheck.sql`
   Queries C and D must show nothing, and A must list all 17 migrations.
   Otherwise stop here and restart the app on the previous code.
5. **Revert the database:** `node prisma/revert/db.mjs sql prisma/revert/02-revert-to-onboarding.sql`
6. **Build:**
   `npm ci && npx prisma generate`
7. **IBANs back to plain text** (needs `DATA_ENCRYPTION_KEY` still in `.env`):
   `npx tsx prisma/revert/03-decrypt-ibans.ts` (dry run), then
   `npx tsx prisma/revert/03-decrypt-ibans.ts --apply`
8. **Confirm** `npx prisma migrate status` says *Database schema is up to date*,
   then `npx prisma migrate deploy && npm run build`
9. **Frontend and restart:**
   `cd ../frontend && npm ci && npm run build && pm2 restart onboarding-api onboarding-worker`

If the pre-check (step 4) stops you: `git checkout hr-platform-2026-10-22`,
rebuild, and `pm2 restart` — nothing in the database changed.

If anything fails between steps 5 and 9: `pm2 stop`, restore the backup from
step 3 (`mysql … < backup.sql`), `git checkout hr-platform-2026-10-22`, rebuild,
and restart — the system is then exactly as before.
