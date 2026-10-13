-- Managers on companies and org units; job titles become an independent
-- master per company (no unit link). Hand-checked: the generated diff
-- re-added an existing parent FK and forgot to restore the companyId FK.

-- positions: drop the unit link (its FK, the index that backed it, the column)
ALTER TABLE `positions` DROP FOREIGN KEY `positions_companyId_fkey`;
ALTER TABLE `positions` DROP FOREIGN KEY `positions_orgUnitId_fkey`;
DROP INDEX `positions_companyId_orgUnitId_active_idx` ON `positions`;
ALTER TABLE `positions` DROP COLUMN `orgUnitId`;
CREATE INDEX `positions_companyId_active_idx` ON `positions`(`companyId`, `active`);
ALTER TABLE `positions` ADD CONSTRAINT `positions_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- managers (staff accounts); a deleted account simply leaves the seat empty
ALTER TABLE `companies` ADD COLUMN `managerId` VARCHAR(191) NULL;
ALTER TABLE `companies` ADD CONSTRAINT `companies_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `org_units` ADD COLUMN `managerId` VARCHAR(191) NULL;
ALTER TABLE `org_units` ADD CONSTRAINT `org_units_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
