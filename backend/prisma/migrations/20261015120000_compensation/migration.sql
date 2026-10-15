-- CreateTable
CREATE TABLE `pay_components` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameAr` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'EARNING',
    `method` VARCHAR(191) NOT NULL DEFAULT 'FIXED',
    `defaultPercent` DECIMAL(5, 2) NULL,
    `gosiBase` BOOLEAN NOT NULL DEFAULT false,
    `prorated` BOOLEAN NOT NULL DEFAULT true,
    `hourlyBase` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 100,
    `system` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pay_components_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_compensations` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATE NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'SAR',
    `reason` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `employee_compensations_companyId_effectiveFrom_idx`(`companyId`, `effectiveFrom`),
    UNIQUE INDEX `employee_compensations_employeeId_effectiveFrom_key`(`employeeId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_compensation_lines` (
    `id` VARCHAR(191) NOT NULL,
    `compensationId` VARCHAR(191) NOT NULL,
    `componentId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NULL,
    `percent` DECIMAL(5, 2) NULL,

    UNIQUE INDEX `employee_compensation_lines_compensationId_componentId_key`(`compensationId`, `componentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_policies` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATE NOT NULL,
    `frequency` VARCHAR(191) NOT NULL DEFAULT 'MONTHLY',
    `cutoffDay` INTEGER NOT NULL DEFAULT 25,
    `payDay` INTEGER NOT NULL DEFAULT 27,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'SAR',
    `proration` VARCHAR(191) NOT NULL DEFAULT 'WORKING_DAYS',
    `rateDaysPerMonth` INTEGER NOT NULL DEFAULT 30,
    `hoursPerDay` DECIMAL(4, 2) NOT NULL DEFAULT 8,
    `overtimePremiumPct` DECIMAL(5, 2) NOT NULL DEFAULT 50,
    `gosiSaudiEmployeePct` DECIMAL(5, 2) NULL,
    `gosiSaudiEmployerPct` DECIMAL(5, 2) NULL,
    `gosiNonSaudiEmployerPct` DECIMAL(5, 2) NULL,
    `gosiWageCap` DECIMAL(12, 2) NULL,
    `roundingDecimals` INTEGER NOT NULL DEFAULT 2,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payroll_policies_companyId_effectiveFrom_key`(`companyId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pay_components` ADD CONSTRAINT `pay_components_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_compensations` ADD CONSTRAINT `employee_compensations_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_compensations` ADD CONSTRAINT `employee_compensations_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_compensation_lines` ADD CONSTRAINT `employee_compensation_lines_compensationId_fkey` FOREIGN KEY (`compensationId`) REFERENCES `employee_compensations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_compensation_lines` ADD CONSTRAINT `employee_compensation_lines_componentId_fkey` FOREIGN KEY (`componentId`) REFERENCES `pay_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_policies` ADD CONSTRAINT `payroll_policies_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
