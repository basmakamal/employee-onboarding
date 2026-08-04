-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` ENUM('HR', 'ADMIN') NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trainees` (
    `id` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `nationalId` VARCHAR(191) NULL,
    `birthDate` DATETIME(3) NULL,
    `department` VARCHAR(191) NULL,
    `jobTitle` VARCHAR(191) NULL,
    `status` ENUM('CREATED', 'AWAITING_FORM', 'FORM_RECEIVED', 'CONTRACT_CREATION', 'AWAITING_CONTRACT_APPROVAL', 'EMPLOYEE_CREATED', 'EXPIRED') NOT NULL DEFAULT 'CREATED',
    `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastReminderAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trainees_email_key`(`email`),
    INDEX `trainees_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trainee_documents` (
    `id` VARCHAR(191) NOT NULL,
    `traineeId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `storageKey` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NULL,
    `sizeBytes` INTEGER NULL,
    `uploadedAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,

    UNIQUE INDEX `trainee_documents_traineeId_type_key`(`traineeId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contracts` (
    `id` VARCHAR(191) NOT NULL,
    `traineeId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NULL,
    `details` JSON NULL,
    `sentAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `contracts_traineeId_key`(`traineeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` VARCHAR(191) NOT NULL,
    `employeeNo` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `nationalId` VARCHAR(191) NULL,
    `birthDate` DATETIME(3) NULL,
    `department` VARCHAR(191) NULL,
    `project` VARCHAR(191) NULL,
    `jobTitle` VARCHAR(191) NULL,
    `hireDate` DATETIME(3) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `traineeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employees_employeeNo_key`(`employeeNo`),
    UNIQUE INDEX `employees_email_key`(`email`),
    UNIQUE INDEX `employees_traineeId_key`(`traineeId`),
    INDEX `employees_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gosi_processes` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'DONE', 'ON_HOLD', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `holdReason` ENUM('OPTIONAL_SUBSCRIPTION', 'GOVERNMENT_EMPLOYEE', 'DOB_MISMATCH', 'ID_MISMATCH', 'INCOMPLETE_DATA', 'OTHER') NULL,
    `holdNote` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gosi_processes_employeeId_key`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `medical_insurance_processes` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'DONE', 'ON_HOLD', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `holdReason` ENUM('ELM_DATA_ISSUE', 'OTHER_INSURANCE_EXISTS', 'EMPLOYEE_DECLINED', 'AWAITING_INSURER', 'INCOMPLETE_DATA', 'OTHER') NULL,
    `holdNote` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `medical_insurance_processes_employeeId_key`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `criminal_record_processes` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `status` ENUM('TRAINING', 'REQUEST_SENT', 'PENDING', 'DONE') NOT NULL DEFAULT 'TRAINING',
    `certificateStorageKey` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `criminal_record_processes_employeeId_key`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assets` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `serialNumber` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `assets_serialNumber_key`(`serialNumber`),
    INDEX `assets_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_forms` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'PENDING_EMPLOYEE_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `deliveryDate` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `decidedAt` DATETIME(3) NULL,
    `rejectReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `asset_forms_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_form_items` (
    `id` VARCHAR(191) NOT NULL,
    `formId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `serialNumber` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `condition` ENUM('NEW', 'USED') NOT NULL DEFAULT 'NEW',
    `notes` VARCHAR(191) NULL,
    `returnedAt` DATETIME(3) NULL,

    INDEX `asset_form_items_formId_idx`(`formId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offboardings` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `reason` ENUM('RESIGNATION', 'TERMINATION', 'CONTRACT_EXPIRY', 'RETIREMENT', 'DEATH') NOT NULL,
    `status` ENUM('REQUESTED', 'IN_PROGRESS', 'ASSETS_PENDING', 'NOTICE_SENT', 'SETTLEMENT', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED',
    `notes` VARCHAR(191) NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `exitInterviewSentAt` DATETIME(3) NULL,
    `exitInterviewCompletedAt` DATETIME(3) NULL,
    `exitInterviewData` JSON NULL,
    `assetsConfirmedAt` DATETIME(3) NULL,
    `assetsConfirmedById` VARCHAR(191) NULL,
    `noticeSentAt` DATETIME(3) NULL,
    `noticeStorageKey` VARCHAR(191) NULL,
    `settlementWorkingDays` INTEGER NULL,
    `settlementLeaveDays` DECIMAL(6, 2) NULL,
    `settlementDeductions` DECIMAL(12, 2) NULL,
    `settlementEntitlements` DECIMAL(12, 2) NULL,
    `settlementNotes` VARCHAR(191) NULL,
    `settlementApprovedById` VARCHAR(191) NULL,
    `settlementApprovedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `offboardings_employeeId_idx`(`employeeId`),
    INDEX `offboardings_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sla_rules` (
    `id` VARCHAR(191) NOT NULL,
    `processKey` VARCHAR(191) NOT NULL DEFAULT 'TRAINEE',
    `status` VARCHAR(191) NOT NULL,
    `afterValue` INTEGER NOT NULL,
    `afterUnit` ENUM('HOURS', 'CALENDAR_DAYS', 'WORKING_DAYS') NOT NULL,
    `action` ENUM('REMIND', 'REMIND_DAILY', 'EXPIRE') NOT NULL,
    `notifySubject` BOOLEAN NOT NULL DEFAULT true,
    `notifyHr` BOOLEAN NOT NULL DEFAULT true,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sla_rules_processKey_status_active_idx`(`processKey`, `status`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `holidays_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `channel` ENUM('EMAIL', 'IN_APP') NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `recipientUserId` VARCHAR(191) NULL,
    `recipientEmail` VARCHAR(191) NULL,
    `locale` VARCHAR(191) NOT NULL DEFAULT 'ar',
    `subject` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `entity` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_recipientUserId_readAt_idx`(`recipientUserId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `link_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `purpose` ENUM('DATA_FORM', 'CONTRACT_APPROVAL', 'ASSET_APPROVAL', 'EXIT_INTERVIEW') NOT NULL,
    `traineeId` VARCHAR(191) NULL,
    `employeeId` VARCHAR(191) NULL,
    `assetFormId` VARCHAR(191) NULL,
    `offboardingId` VARCHAR(191) NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `link_tokens_tokenHash_key`(`tokenHash`),
    INDEX `link_tokens_traineeId_idx`(`traineeId`),
    INDEX `link_tokens_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NULL,
    `actorType` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `traineeId` VARCHAR(191) NULL,
    `employeeId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `audit_logs_traineeId_at_idx`(`traineeId`, `at`),
    INDEX `audit_logs_employeeId_at_idx`(`employeeId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `trainees` ADD CONSTRAINT `trainees_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trainee_documents` ADD CONSTRAINT `trainee_documents_traineeId_fkey` FOREIGN KEY (`traineeId`) REFERENCES `trainees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_traineeId_fkey` FOREIGN KEY (`traineeId`) REFERENCES `trainees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_traineeId_fkey` FOREIGN KEY (`traineeId`) REFERENCES `trainees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gosi_processes` ADD CONSTRAINT `gosi_processes_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `medical_insurance_processes` ADD CONSTRAINT `medical_insurance_processes_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `criminal_record_processes` ADD CONSTRAINT `criminal_record_processes_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_forms` ADD CONSTRAINT `asset_forms_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_forms` ADD CONSTRAINT `asset_forms_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_form_items` ADD CONSTRAINT `asset_form_items_formId_fkey` FOREIGN KEY (`formId`) REFERENCES `asset_forms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_form_items` ADD CONSTRAINT `asset_form_items_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offboardings` ADD CONSTRAINT `offboardings_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offboardings` ADD CONSTRAINT `offboardings_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipientUserId_fkey` FOREIGN KEY (`recipientUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `link_tokens` ADD CONSTRAINT `link_tokens_traineeId_fkey` FOREIGN KEY (`traineeId`) REFERENCES `trainees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `link_tokens` ADD CONSTRAINT `link_tokens_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `link_tokens` ADD CONSTRAINT `link_tokens_assetFormId_fkey` FOREIGN KEY (`assetFormId`) REFERENCES `asset_forms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `link_tokens` ADD CONSTRAINT `link_tokens_offboardingId_fkey` FOREIGN KEY (`offboardingId`) REFERENCES `offboardings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_traineeId_fkey` FOREIGN KEY (`traineeId`) REFERENCES `trainees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
