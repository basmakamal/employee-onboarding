-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `templateKey` VARCHAR(191) NULL,
    ADD COLUMN `templateVersion` INTEGER NULL;

-- AlterTable
ALTER TABLE `sla_rules` ADD COLUMN `staffTemplateKey` VARCHAR(191) NULL,
    ADD COLUMN `subjectTemplateKey` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `email_templates` (
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `subjectAr` VARCHAR(191) NOT NULL,
    `subjectEn` VARCHAR(191) NOT NULL,
    `bodyAr` TEXT NOT NULL,
    `bodyEn` TEXT NOT NULL,
    `ctaLabelAr` VARCHAR(191) NULL,
    `ctaLabelEn` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` VARCHAR(191) NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_triggers` (
    `id` VARCHAR(191) NOT NULL,
    `processKey` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `templateKey` VARCHAR(191) NOT NULL,
    `recipient` ENUM('SUBJECT', 'ROLE') NOT NULL,
    `role` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` VARCHAR(191) NULL,

    INDEX `email_triggers_processKey_status_active_idx`(`processKey`, `status`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
