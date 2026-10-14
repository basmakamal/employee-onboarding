-- Lists become per company: every company owns its own copy of every list.
--
-- Until now every row was shared (companyId NULL). The rows — including
-- labels an admin already edited and values staff typed — are copied into
-- EVERY existing company, then the shared rows are removed. A company
-- created later is seeded from the catalogue by the API (ListService).

-- DropForeignKey
ALTER TABLE `list_values` DROP FOREIGN KEY `list_values_companyId_fkey`;

-- DropIndex
DROP INDEX `list_values_list_active_sortOrder_idx` ON `list_values`;

-- DropIndex (one code per list → one code per list per company)
DROP INDEX `list_values_list_code_key` ON `list_values`;

-- Copy the shared rows into every company.
INSERT INTO `list_values` (`id`, `companyId`, `list`, `code`, `labelAr`, `labelEn`, `sortOrder`, `active`, `system`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('lv', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 23)),
    c.`id`, v.`list`, v.`code`, v.`labelAr`, v.`labelEn`, v.`sortOrder`, v.`active`, v.`system`, v.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `list_values` v
CROSS JOIN `companies` c
WHERE v.`companyId` IS NULL;

-- The shared rows have been copied; remove them.
DELETE FROM `list_values` WHERE `companyId` IS NULL;

-- AlterTable
ALTER TABLE `list_values` MODIFY `companyId` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `list_values_companyId_list_code_key` ON `list_values`(`companyId`, `list`, `code`);

-- AddForeignKey
ALTER TABLE `list_values` ADD CONSTRAINT `list_values_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
