-- AlterTable
ALTER TABLE `one_time_payments` ADD COLUMN `correctsRunId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `payroll_runs` ADD COLUMN `reopenReason` TEXT NULL,
    ADD COLUMN `reopenedAt` DATETIME(3) NULL,
    ADD COLUMN `reopenedById` VARCHAR(191) NULL;
