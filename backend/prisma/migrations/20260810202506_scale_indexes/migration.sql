-- DropIndex
DROP INDEX `employees_status_idx` ON `employees`;

-- DropIndex
DROP INDEX `offboardings_status_idx` ON `offboardings`;

-- CreateIndex
CREATE INDEX `audit_logs_at_idx` ON `audit_logs`(`at`);

-- CreateIndex
CREATE INDEX `employees_status_statusChangedAt_idx` ON `employees`(`status`, `statusChangedAt`);

-- CreateIndex
CREATE INDEX `employees_createdAt_idx` ON `employees`(`createdAt`);

-- CreateIndex
CREATE INDEX `gosi_processes_status_updatedAt_idx` ON `gosi_processes`(`status`, `updatedAt`);

-- CreateIndex
CREATE INDEX `medical_insurance_processes_status_updatedAt_idx` ON `medical_insurance_processes`(`status`, `updatedAt`);

-- CreateIndex
CREATE INDEX `notifications_recipientUserId_createdAt_idx` ON `notifications`(`recipientUserId`, `createdAt`);

-- CreateIndex
CREATE INDEX `offboardings_status_updatedAt_idx` ON `offboardings`(`status`, `updatedAt`);
