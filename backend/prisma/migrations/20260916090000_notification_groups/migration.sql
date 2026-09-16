
-- AlterTable
ALTER TABLE `email_triggers` ADD COLUMN `groupId` VARCHAR(191) NULL,
    MODIFY `recipient` ENUM('SUBJECT', 'ROLE', 'GROUP') NOT NULL;

-- CreateTable
CREATE TABLE `notification_groups` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `nameAr` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_groups_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_group_members` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,

    UNIQUE INDEX `notification_group_members_groupId_email_key`(`groupId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_group_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `processKey` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,

    INDEX `notification_group_assignments_processKey_status_idx`(`processKey`, `status`),
    UNIQUE INDEX `notification_group_assignments_groupId_processKey_status_key`(`groupId`, `processKey`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notification_group_members` ADD CONSTRAINT `notification_group_members_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `notification_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_group_members` ADD CONSTRAINT `notification_group_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_group_assignments` ADD CONSTRAINT `notification_group_assignments_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `notification_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

