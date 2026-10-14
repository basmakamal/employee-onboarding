-- Audit trail: field-level before/after, where the action came from, and the request it belonged to.

-- AlterTable
ALTER TABLE `audit_logs` ADD COLUMN `changes` JSON NULL,
    ADD COLUMN `requestId` VARCHAR(191) NULL,
    ADD COLUMN `source` VARCHAR(191) NULL;

