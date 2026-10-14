-- Self-service accounts: an employee may get their own sign-in (role EMPLOYEE),
-- linked to exactly one employee record. Created by HR; never reaches the staff API.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `employeeId` VARCHAR(191) NULL,
    MODIFY `role` ENUM('HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN', 'EMPLOYEE') NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_employeeId_key` ON `users`(`employeeId`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

