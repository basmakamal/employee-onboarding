-- AlterTable
ALTER TABLE `employee_requests` ADD COLUMN `fileName` VARCHAR(191) NULL,
    ADD COLUMN `mimeType` VARCHAR(191) NULL,
    ADD COLUMN `storageKey` VARCHAR(191) NULL;
