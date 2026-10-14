-- Phase C: shifts. Reusable shift definitions, weekly / rotating patterns, and
-- effective-dated assignments per employee. Holidays may now be limited to one branch.

-- DropForeignKey
ALTER TABLE `holidays` DROP FOREIGN KEY `holidays_companyId_fkey`;

-- DropIndex
DROP INDEX `holidays_companyId_date_key` ON `holidays`;

-- AlterTable
ALTER TABLE `holidays` ADD COLUMN `orgUnitId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `shift_definitions` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameAr` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'FIXED',
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `breakMinutes` INTEGER NOT NULL DEFAULT 0,
    `graceMinutes` INTEGER NOT NULL DEFAULT 0,
    `requiredMinutes` INTEGER NULL,
    `color` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shift_definitions_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_patterns` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameAr` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'WEEKLY',
    `cycleDays` INTEGER NOT NULL DEFAULT 7,
    `days` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shift_patterns_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `patternId` VARCHAR(191) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `temporary` BOOLEAN NOT NULL DEFAULT false,
    `reason` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shift_assignments_companyId_employeeId_startDate_idx`(`companyId`, `employeeId`, `startDate`),
    INDEX `shift_assignments_employeeId_temporary_startDate_idx`(`employeeId`, `temporary`, `startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `holidays_companyId_date_orgUnitId_key` ON `holidays`(`companyId`, `date`, `orgUnitId`);

-- AddForeignKey
ALTER TABLE `shift_definitions` ADD CONSTRAINT `shift_definitions_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_patterns` ADD CONSTRAINT `shift_patterns_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_assignments` ADD CONSTRAINT `shift_assignments_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_assignments` ADD CONSTRAINT `shift_assignments_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_assignments` ADD CONSTRAINT `shift_assignments_patternId_fkey` FOREIGN KEY (`patternId`) REFERENCES `shift_patterns`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Re-add the company foreign key of holidays (dropped above to rebuild its unique index).
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
