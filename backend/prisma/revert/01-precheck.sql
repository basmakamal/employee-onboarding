-- ─────────────────────────────────────────────────────────────────────────
-- Revert to the onboarding-only system — STEP 1: read-only pre-check.
-- Changes nothing. Every query below must return NO rows (or "0") before
-- 02-revert-to-onboarding.sql is run. See README.md in this folder.
-- ─────────────────────────────────────────────────────────────────────────

-- A. Which of the 17 migrations being undone are applied here?
--    The full HR platform shows all 17 names (an old failed attempt can add an
--    extra row with an empty finished_at — that is fine). Any name missing →
--    stop and tell the developer: the revert script assumes all 17.
SELECT migration_name, finished_at
FROM _prisma_migrations
WHERE migration_name >= '20261013090000'
ORDER BY migration_name;

-- B. The main company — its lists, settings, templates, triggers, SLA rules
--    and holidays are the ones kept. (The oldest company = the original one.)
SELECT id, code, nameEn, createdAt FROM companies ORDER BY createdAt, id LIMIT 1;

-- C. Must be empty: the same e-mail on two employees (allowed per company
--    today, not allowed in the onboarding system).
SELECT email, COUNT(*) AS employees FROM employees GROUP BY email HAVING COUNT(*) > 1;

-- D. Must be empty: the same asset serial number twice.
SELECT serialNumber, COUNT(*) AS assets FROM assets
WHERE serialNumber IS NOT NULL GROUP BY serialNumber HAVING COUNT(*) > 1;

-- E. For information: employees outside the main company. They stay in the
--    system (the onboarding system has no companies) — check this is wanted.
SELECT COUNT(*) AS employees_outside_main_company FROM employees
WHERE companyId IS NOT NULL
  AND companyId <> (SELECT id FROM companies ORDER BY createdAt, id LIMIT 1);

-- F. For information: employee login accounts that will be removed
--    (they were already switched off by the staff-only change).
SELECT COUNT(*) AS employee_accounts FROM users WHERE role = 'EMPLOYEE';
