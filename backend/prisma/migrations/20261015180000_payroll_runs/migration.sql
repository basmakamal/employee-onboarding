-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'CALCULATED',
    `periodFrom` DATE NOT NULL,
    `periodTo` DATE NOT NULL,
    `policyId` VARCHAR(191) NULL,
    `engineVersion` VARCHAR(191) NOT NULL,
    `employees` INTEGER NOT NULL DEFAULT 0,
    `gross` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `deductions` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `net` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `employerCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `warnings` JSON NULL,
    `calculatedById` VARCHAR(191) NULL,
    `calculatedAt` DATETIME(3) NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `paidById` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_runs_companyId_status_idx`(`companyId`, `status`),
    UNIQUE INDEX `payroll_runs_companyId_month_version_key`(`companyId`, `month`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_lines` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `gross` DECIMAL(12, 2) NOT NULL,
    `deductions` DECIMAL(12, 2) NOT NULL,
    `net` DECIMAL(12, 2) NOT NULL,
    `employerCost` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `previousNet` DECIMAL(12, 2) NULL,
    `held` BOOLEAN NOT NULL DEFAULT false,
    `heldReason` TEXT NULL,
    `inputs` JSON NOT NULL,
    `warnings` JSON NULL,

    INDEX `payroll_lines_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `payroll_lines_runId_employeeId_key`(`runId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_line_items` (
    `id` VARCHAR(191) NOT NULL,
    `lineId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NULL,
    `code` VARCHAR(191) NOT NULL,
    `labelAr` VARCHAR(191) NOT NULL,
    `labelEn` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NULL,
    `rate` DECIMAL(12, 4) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 100,

    INDEX `payroll_line_items_lineId_idx`(`lineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_lines` ADD CONSTRAINT `payroll_lines_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `payroll_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_lines` ADD CONSTRAINT `payroll_lines_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_line_items` ADD CONSTRAINT `payroll_line_items_lineId_fkey` FOREIGN KEY (`lineId`) REFERENCES `payroll_lines`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
