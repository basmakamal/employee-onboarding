-- CreateTable
CREATE TABLE `status_ownership` (
    `id` VARCHAR(191) NOT NULL,
    `processKey` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `roles` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `status_ownership_processKey_status_key`(`processKey`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
