-- CreateTable
CREATE TABLE `attendance_events` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NULL,
    `importBatchId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `attendance_events_fingerprint_key`(`fingerprint`),
    INDEX `attendance_events_companyId_employeeId_at_idx`(`companyId`, `employeeId`, `at`),
    INDEX `attendance_events_employeeId_at_idx`(`employeeId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_days` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `shiftCodes` VARCHAR(191) NULL,
    `scheduledMinutes` INTEGER NOT NULL DEFAULT 0,
    `workedMinutes` INTEGER NOT NULL DEFAULT 0,
    `lateMinutes` INTEGER NOT NULL DEFAULT 0,
    `earlyLeaveMinutes` INTEGER NOT NULL DEFAULT 0,
    `overtimeMinutes` INTEGER NOT NULL DEFAULT 0,
    `firstIn` DATETIME(3) NULL,
    `lastOut` DATETIME(3) NULL,
    `review` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_days_companyId_date_idx`(`companyId`, `date`),
    INDEX `attendance_days_companyId_review_date_idx`(`companyId`, `review`, `date`),
    UNIQUE INDEX `attendance_days_employeeId_date_key`(`employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `overtime_requests` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `minutes` INTEGER NOT NULL,
    `approvedMinutes` INTEGER NULL,
    `reason` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `requestedById` VARCHAR(191) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `overtime_requests_companyId_status_createdAt_idx`(`companyId`, `status`, `createdAt`),
    INDEX `overtime_requests_employeeId_date_idx`(`employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_days` ADD CONSTRAINT `attendance_days_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_days` ADD CONSTRAINT `attendance_days_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `overtime_requests` ADD CONSTRAINT `overtime_requests_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `overtime_requests` ADD CONSTRAINT `overtime_requests_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
