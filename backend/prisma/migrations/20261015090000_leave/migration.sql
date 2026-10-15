-- AlterTable
ALTER TABLE `attendance_days` ADD COLUMN `leaveCode` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `leave_types` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameAr` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `paidPercent` INTEGER NOT NULL DEFAULT 100,
    `balanceMode` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `accrual` VARCHAR(191) NULL,
    `daysPerYear` DECIMAL(6, 2) NULL,
    `seniorDaysPerYear` DECIMAL(6, 2) NULL,
    `seniorAfterYears` INTEGER NULL,
    `carryForwardMax` DECIMAL(6, 2) NULL,
    `yearlyLimit` INTEGER NULL,
    `payTiers` JSON NULL,
    `maxPerRequest` INTEGER NULL,
    `oncePerService` BOOLEAN NOT NULL DEFAULT false,
    `minServiceMonths` INTEGER NULL,
    `gender` VARCHAR(191) NOT NULL DEFAULT 'ANY',
    `countMode` VARCHAR(191) NOT NULL DEFAULT 'WORKING',
    `allowHalfDay` BOOLEAN NOT NULL DEFAULT false,
    `system` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leave_types_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_requests` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `leaveTypeId` VARCHAR(191) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `halfDay` BOOLEAN NOT NULL DEFAULT false,
    `days` DECIMAL(6, 2) NOT NULL,
    `payBreakdown` JSON NULL,
    `reason` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `requestedById` VARCHAR(191) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_requests_companyId_status_createdAt_idx`(`companyId`, `status`, `createdAt`),
    INDEX `leave_requests_employeeId_startDate_idx`(`employeeId`, `startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_ledger` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `leaveTypeId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `days` DECIMAL(6, 2) NOT NULL,
    `date` DATE NOT NULL,
    `requestId` VARCHAR(191) NULL,
    `periodKey` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_ledger_employeeId_leaveTypeId_date_idx`(`employeeId`, `leaveTypeId`, `date`),
    UNIQUE INDEX `leave_ledger_employeeId_leaveTypeId_kind_periodKey_key`(`employeeId`, `leaveTypeId`, `kind`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `leave_types` ADD CONSTRAINT `leave_types_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_ledger` ADD CONSTRAINT `leave_ledger_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_ledger` ADD CONSTRAINT `leave_ledger_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_ledger` ADD CONSTRAINT `leave_ledger_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_ledger` ADD CONSTRAINT `leave_ledger_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `leave_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
