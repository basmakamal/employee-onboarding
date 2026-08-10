-- AlterTable
ALTER TABLE `employees` ADD COLUMN `birthDateHijri` VARCHAR(191) NULL,
    ADD COLUMN `emergencyContactName` VARCHAR(191) NULL,
    ADD COLUMN `emergencyContactPhone` VARCHAR(191) NULL,
    ADD COLUMN `fatherName` VARCHAR(191) NULL,
    ADD COLUMN `gender` ENUM('MALE', 'FEMALE') NULL,
    ADD COLUMN `grandfatherName` VARCHAR(191) NULL,
    ADD COLUMN `iban` VARCHAR(191) NULL,
    ADD COLUMN `major` VARCHAR(191) NULL,
    ADD COLUMN `maritalStatus` ENUM('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED') NULL,
    ADD COLUMN `nationality` VARCHAR(191) NULL,
    ADD COLUMN `qualification` ENUM('HIGH_SCHOOL', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD', 'OTHER') NULL,
    ADD COLUMN `splAddress` VARCHAR(191) NULL;
