-- AlterTable
ALTER TABLE `sla_rules` ADD COLUMN `escalateToRole` VARCHAR(191) NULL,
    ADD COLUMN `notifyRole` VARCHAR(191) NOT NULL DEFAULT 'HR',
    MODIFY `action` ENUM('REMIND', 'REMIND_DAILY', 'ESCALATE', 'EXPIRE') NOT NULL;

-- CreateTable
CREATE TABLE `sla_firings` (
    `id` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `firedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sla_firings_ruleId_entityId_firedAt_idx`(`ruleId`, `entityId`, `firedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sla_firings` ADD CONSTRAINT `sla_firings_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `sla_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
