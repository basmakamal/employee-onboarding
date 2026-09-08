-- AlterTable
ALTER TABLE `gosi_processes` ADD COLUMN `certificateStorageKey` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `medical_insurance_processes` ADD COLUMN `certificateStorageKey` VARCHAR(191) NULL;
