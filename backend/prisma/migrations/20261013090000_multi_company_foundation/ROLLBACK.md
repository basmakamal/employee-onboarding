# Rollback — multi-company foundation (20261013090000)

This migration is **additive**: new tables, nullable columns, and two uniques
widened to per-company composites. No existing column is dropped or
rewritten, and existing rows are untouched until `scripts/migrate-multi-company.ts --apply`
is run deliberately.

Prisma Migrate has no automatic "down". To revert on a database where this
migration was applied, run the statements below in a transaction, then delete
the migration row:

```sql
START TRANSACTION;

-- Mapping data (safe to drop: legacy string columns were never removed)
ALTER TABLE `employees`     DROP FOREIGN KEY `employees_companyId_fkey`,  DROP FOREIGN KEY `employees_orgUnitId_fkey`,
                            DROP FOREIGN KEY `employees_positionId_fkey`, DROP FOREIGN KEY `employees_managerId_fkey`;
ALTER TABLE `employees`     DROP INDEX `employees_companyId_email_key`, DROP INDEX `employees_companyId_status_statusChangedAt_idx`,
                            DROP INDEX `employees_companyId_orgUnitId_idx`, DROP INDEX `employees_companyId_createdAt_idx`;
ALTER TABLE `employees`     DROP COLUMN `companyId`, DROP COLUMN `orgUnitId`, DROP COLUMN `positionId`, DROP COLUMN `managerId`;
ALTER TABLE `employees`     ADD UNIQUE INDEX `employees_email_key`(`email`);

ALTER TABLE `assets`        DROP FOREIGN KEY `assets_companyId_fkey`;
ALTER TABLE `assets`        DROP INDEX `assets_companyId_serialNumber_key`, DROP INDEX `assets_companyId_type_idx`, DROP COLUMN `companyId`;
ALTER TABLE `assets`        ADD UNIQUE INDEX `assets_serialNumber_key`(`serialNumber`);

ALTER TABLE `list_values`   DROP FOREIGN KEY `list_values_companyId_fkey`;
ALTER TABLE `list_values`   DROP INDEX `list_values_companyId_list_active_sortOrder_idx`, DROP COLUMN `companyId`;

ALTER TABLE `audit_logs`    DROP FOREIGN KEY `audit_logs_companyId_fkey`;
ALTER TABLE `audit_logs`    DROP INDEX `audit_logs_companyId_at_idx`, DROP COLUMN `companyId`;

ALTER TABLE `notifications` DROP FOREIGN KEY `notifications_companyId_fkey`;
ALTER TABLE `notifications` DROP INDEX `notifications_companyId_createdAt_idx`, DROP COLUMN `companyId`;

ALTER TABLE `users`         DROP FOREIGN KEY `users_activeCompanyId_fkey`, DROP COLUMN `activeCompanyId`;

DROP TABLE `user_assignments`;
DROP TABLE `role_permissions`;
DROP TABLE `roles`;
DROP TABLE `positions`;
DROP TABLE `org_units`;
DROP TABLE `companies`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261013090000_multi_company_foundation';
COMMIT;
```

Then restore the previous `schema.prisma` and run `npx prisma generate`.

Constraint names are Prisma's defaults (`<table>_<columns>_fkey|key|idx`); verify
with `SHOW CREATE TABLE` before running on a server.
