-- Employment history: dated transfers, promotions, manager and status changes.
-- The opening entry for each existing employee is written by the API at boot.

-- CreateTable
CREATE TABLE `employment_events` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `oldValue` JSON NULL,
    `newValue` JSON NULL,
    `effectiveDate` DATE NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'APPLIED',
    `appliedAt` DATETIME(3) NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `failReason` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employment_events_companyId_employeeId_effectiveDate_idx`(`companyId`, `employeeId`, `effectiveDate`),
    INDEX `employment_events_companyId_status_effectiveDate_idx`(`companyId`, `status`, `effectiveDate`),
    INDEX `employment_events_batchId_idx`(`batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `employment_events` ADD CONSTRAINT `employment_events_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employment_events` ADD CONSTRAINT `employment_events_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employment_events` ADD CONSTRAINT `employment_events_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employment_events` ADD CONSTRAINT `employment_events_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

