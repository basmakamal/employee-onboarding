-- AlterTable
ALTER TABLE `employees` ADD COLUMN `directManager` VARCHAR(191) NULL,
    ADD COLUMN `employmentType` ENUM('FULL_TIME', 'PART_TIME', 'TEMPORARY') NOT NULL DEFAULT 'FULL_TIME',
    ADD COLUMN `photoKey` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `employee_requests` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `type` ENUM('SALARY_LETTER', 'BANK_LETTER', 'DEPARTMENT_CHANGE', 'JOB_TITLE_CHANGE', 'PROMOTION', 'PROJECT_TRANSFER', 'WARNING', 'INVESTIGATION') NOT NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_requests_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `employee_requests` ADD CONSTRAINT `employee_requests_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_requests` ADD CONSTRAINT `employee_requests_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
