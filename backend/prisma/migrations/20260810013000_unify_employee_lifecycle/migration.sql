-- Unify the trainee pipeline into the Employee entity: one record, one
-- lifecycle (CREATED → … → AWAITING_CONTRACT_APPROVAL → ACTIVE → INACTIVE,
-- with EXPIRED). Data-preserving: pipeline trainees become pipeline
-- employees (keeping their ids), converted trainees fold into the employee
-- they already produced. Assumes no pipeline trainee shares an email with
-- an existing employee (both columns were UNIQUE in their own tables).

-- 1. employees: widen the lifecycle
ALTER TABLE `employees`
    ADD COLUMN `createdById` VARCHAR(191) NULL,
    ADD COLUMN `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `employeeNo` VARCHAR(191) NULL,
    MODIFY `hireDate` DATETIME(3) NULL,
    MODIFY `status` ENUM('CREATED', 'AWAITING_FORM', 'FORM_RECEIVED', 'CONTRACT_CREATION', 'AWAITING_CONTRACT_APPROVAL', 'EXPIRED', 'ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'CREATED';

-- 2. pipeline trainees (never converted) become employees, keeping their ids
--    so that documents / contracts / tokens / audit rows need no id remapping
INSERT INTO `employees`
    (`id`, `firstName`, `lastName`, `email`, `phone`, `nationalId`, `birthDate`,
     `department`, `jobTitle`, `status`, `statusChangedAt`, `createdById`,
     `createdAt`, `updatedAt`)
SELECT t.`id`, t.`firstName`, t.`lastName`, t.`email`, t.`phone`, t.`nationalId`, t.`birthDate`,
       t.`department`, t.`jobTitle`,
       CASE t.`status` WHEN 'EMPLOYEE_CREATED' THEN 'ACTIVE' ELSE t.`status` END,
       t.`statusChangedAt`, t.`createdById`, t.`createdAt`, t.`updatedAt`
FROM `trainees` t
LEFT JOIN `employees` e ON e.`traineeId` = t.`id`
WHERE e.`id` IS NULL;

-- 3. detach every child from the trainees table
ALTER TABLE `trainee_documents` DROP FOREIGN KEY `trainee_documents_traineeId_fkey`;
ALTER TABLE `contracts` DROP FOREIGN KEY `contracts_traineeId_fkey`;
ALTER TABLE `link_tokens` DROP FOREIGN KEY `link_tokens_traineeId_fkey`;
ALTER TABLE `audit_logs` DROP FOREIGN KEY `audit_logs_traineeId_fkey`;
ALTER TABLE `employees` DROP FOREIGN KEY `employees_traineeId_fkey`;
ALTER TABLE `trainees` DROP FOREIGN KEY `trainees_createdById_fkey`;

-- 4. onboarding checklist: new table, data copied across
CREATE TABLE `onboarding_documents` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `storageKey` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NULL,
    `sizeBytes` INTEGER NULL,
    `uploadedAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,

    UNIQUE INDEX `onboarding_documents_employeeId_type_key`(`employeeId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `onboarding_documents`
    (`id`, `employeeId`, `type`, `label`, `required`, `storageKey`, `mimeType`, `sizeBytes`, `uploadedAt`, `notes`)
SELECT d.`id`, COALESCE(e.`id`, d.`traineeId`), d.`type`, d.`label`, d.`required`,
       d.`storageKey`, d.`mimeType`, d.`sizeBytes`, d.`uploadedAt`, d.`notes`
FROM `trainee_documents` d
LEFT JOIN `employees` e ON e.`traineeId` = d.`traineeId`;

DROP TABLE `trainee_documents`;

-- 5. contracts: re-key from the trainee to the employee
ALTER TABLE `contracts` ADD COLUMN `employeeId` VARCHAR(191) NULL;

UPDATE `contracts` c
LEFT JOIN `employees` e ON e.`traineeId` = c.`traineeId`
SET c.`employeeId` = COALESCE(e.`id`, c.`traineeId`);

ALTER TABLE `contracts` MODIFY `employeeId` VARCHAR(191) NOT NULL;
DROP INDEX `contracts_traineeId_key` ON `contracts`;
ALTER TABLE `contracts` DROP COLUMN `traineeId`;
CREATE UNIQUE INDEX `contracts_employeeId_key` ON `contracts`(`employeeId`);

-- 6. link tokens: fold the trainee anchor into the employee anchor
UPDATE `link_tokens` l
LEFT JOIN `employees` e ON e.`traineeId` = l.`traineeId`
SET l.`employeeId` = COALESCE(e.`id`, l.`traineeId`)
WHERE l.`traineeId` IS NOT NULL;

DROP INDEX `link_tokens_traineeId_idx` ON `link_tokens`;
ALTER TABLE `link_tokens` DROP COLUMN `traineeId`;

-- 7. audit trail: one anchor, one entity name, one terminal status
UPDATE `audit_logs` a
LEFT JOIN `employees` e ON e.`traineeId` = a.`traineeId`
SET a.`employeeId` = COALESCE(a.`employeeId`, e.`id`, a.`traineeId`)
WHERE a.`traineeId` IS NOT NULL;

UPDATE `audit_logs` a
JOIN `employees` e ON e.`traineeId` = a.`entityId`
SET a.`entityId` = e.`id`
WHERE a.`entity` = 'TRAINEE';

UPDATE `audit_logs` SET `entity` = 'EMPLOYEE' WHERE `entity` = 'TRAINEE';
UPDATE `audit_logs` SET `toStatus` = 'ACTIVE' WHERE `toStatus` = 'EMPLOYEE_CREATED';
UPDATE `audit_logs` SET `fromStatus` = 'ACTIVE' WHERE `fromStatus` = 'EMPLOYEE_CREATED';

DROP INDEX `audit_logs_traineeId_at_idx` ON `audit_logs`;
ALTER TABLE `audit_logs` DROP COLUMN `traineeId`;

-- 8. notification references and scheduler memory follow the same mapping
UPDATE `notifications` n
JOIN `employees` e ON e.`traineeId` = n.`entityId`
SET n.`entityId` = e.`id`
WHERE n.`entity` = 'TRAINEE';

UPDATE `notifications` SET `entity` = 'EMPLOYEE' WHERE `entity` = 'TRAINEE';

UPDATE `sla_firings` f
JOIN `employees` e ON e.`traineeId` = f.`entityId`
SET f.`entityId` = e.`id`;

-- 9. drop the back-link and the trainees table
DROP INDEX `employees_traineeId_key` ON `employees`;
ALTER TABLE `employees` DROP COLUMN `traineeId`;
DROP TABLE `trainees`;

-- 10. configuration rows follow the machine rename
UPDATE `sla_rules` SET `processKey` = 'EMPLOYEE' WHERE `processKey` = 'TRAINEE';
UPDATE `status_ownership` SET `processKey` = 'EMPLOYEE' WHERE `processKey` = 'TRAINEE';
ALTER TABLE `sla_rules` MODIFY `processKey` VARCHAR(191) NOT NULL DEFAULT 'EMPLOYEE';

-- 11. new foreign keys
ALTER TABLE `employees` ADD CONSTRAINT `employees_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `onboarding_documents` ADD CONSTRAINT `onboarding_documents_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
