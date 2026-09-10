-- AlterTable
ALTER TABLE `email_triggers` ADD COLUMN `ccEmails` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `sla_rules` ADD COLUMN `ccEmails` VARCHAR(191) NULL;
