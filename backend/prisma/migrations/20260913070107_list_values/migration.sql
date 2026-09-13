-- CreateTable
CREATE TABLE `list_values` (
    `id` VARCHAR(191) NOT NULL,
    `list` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `labelAr` VARCHAR(191) NOT NULL,
    `labelEn` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `system` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `list_values_list_active_sortOrder_idx`(`list`, `active`, `sortOrder`),
    UNIQUE INDEX `list_values_list_code_key`(`list`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
