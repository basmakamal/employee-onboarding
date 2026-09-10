-- AlterTable
ALTER TABLE `employees` ADD COLUMN `preferredLanguage` ENUM('AR', 'EN') NOT NULL DEFAULT 'AR';
