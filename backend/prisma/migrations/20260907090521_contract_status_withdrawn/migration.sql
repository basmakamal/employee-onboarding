-- AlterTable
ALTER TABLE `contracts` ADD COLUMN `externalRef` VARCHAR(191) NULL,
    ADD COLUMN `rejectReason` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `employees` MODIFY `status` ENUM('CREATED', 'AWAITING_FORM', 'FORM_RECEIVED', 'CONTRACT_CREATION', 'AWAITING_CONTRACT_APPROVAL', 'EXPIRED', 'ACTIVE', 'INACTIVE', 'WITHDRAWN') NOT NULL DEFAULT 'CREATED';

-- Business rule: any authorised teammate may act on the Stage-2 cards. The named
-- primary owners only steer notifications, so widen the existing ownership rows.
UPDATE `status_ownership` SET `roles` = JSON_ARRAY('HR', 'INSURANCE')
 WHERE `processKey` IN ('GOSI', 'MEDICAL_INSURANCE', 'CRIMINAL_RECORD');
