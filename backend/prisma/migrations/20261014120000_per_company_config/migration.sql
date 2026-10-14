-- Automation rules, e-mail templates, e-mail triggers, the work calendar
-- (weekend days + holidays) and settings (mail server…) become per company.
--
-- Every existing row — the admin's edits included — is copied into EVERY
-- existing company, then the shared row is removed. New ids are derived
-- from (old id, company id), so the copies of the automation memory
-- (sla_firings) can point at the right copy of their rule: a reminder that
-- already went out is not sent a second time.

-- ───────────────────────────────────────────── automation rules + memory
ALTER TABLE `sla_rules` ADD COLUMN `companyId` VARCHAR(191) NULL;

INSERT INTO `sla_rules` (`id`, `companyId`, `processKey`, `status`, `afterValue`, `afterUnit`, `action`, `notifySubject`, `notifyHr`, `notifyRole`, `escalateToRole`, `subjectTemplateKey`, `staffTemplateKey`, `ccEmails`, `active`, `createdAt`)
SELECT CONCAT('r', LEFT(MD5(CONCAT(r.`id`, '|', c.`id`)), 24)), c.`id`, r.`processKey`, r.`status`, r.`afterValue`, r.`afterUnit`, r.`action`, r.`notifySubject`, r.`notifyHr`, r.`notifyRole`, r.`escalateToRole`, r.`subjectTemplateKey`, r.`staffTemplateKey`, r.`ccEmails`, r.`active`, r.`createdAt`
FROM `sla_rules` r CROSS JOIN `companies` c
WHERE r.`companyId` IS NULL;

INSERT INTO `sla_firings` (`id`, `ruleId`, `entityId`, `firedAt`)
SELECT CONCAT('f', LEFT(MD5(CONCAT(f.`id`, '|', c.`id`)), 24)), CONCAT('r', LEFT(MD5(CONCAT(f.`ruleId`, '|', c.`id`)), 24)), f.`entityId`, f.`firedAt`
FROM `sla_firings` f
JOIN `sla_rules` r ON r.`id` = f.`ruleId` AND r.`companyId` IS NULL
CROSS JOIN `companies` c;

DELETE f FROM `sla_firings` f JOIN `sla_rules` r ON r.`id` = f.`ruleId` WHERE r.`companyId` IS NULL;
DELETE FROM `sla_rules` WHERE `companyId` IS NULL;

ALTER TABLE `sla_rules` MODIFY `companyId` VARCHAR(191) NOT NULL;
CREATE INDEX `sla_rules_companyId_processKey_status_active_idx` ON `sla_rules`(`companyId`, `processKey`, `status`, `active`);
ALTER TABLE `sla_rules` ADD CONSTRAINT `sla_rules_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────── holidays
ALTER TABLE `holidays` ADD COLUMN `companyId` VARCHAR(191) NULL;
DROP INDEX `holidays_date_key` ON `holidays`;

INSERT INTO `holidays` (`id`, `companyId`, `date`, `name`)
SELECT CONCAT('h', LEFT(MD5(CONCAT(h.`id`, '|', c.`id`)), 24)), c.`id`, h.`date`, h.`name`
FROM `holidays` h CROSS JOIN `companies` c
WHERE h.`companyId` IS NULL;
DELETE FROM `holidays` WHERE `companyId` IS NULL;

ALTER TABLE `holidays` MODIFY `companyId` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `holidays_companyId_date_key` ON `holidays`(`companyId`, `date`);
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────── e-mail templates (key was the primary key)
ALTER TABLE `email_templates` DROP PRIMARY KEY,
    ADD COLUMN `id` VARCHAR(191) NULL,
    ADD COLUMN `companyId` VARCHAR(191) NULL;

INSERT INTO `email_templates` (`id`, `companyId`, `key`, `name`, `subjectAr`, `subjectEn`, `bodyAr`, `bodyEn`, `ctaLabelAr`, `ctaLabelEn`, `audience`, `active`, `version`, `updatedAt`, `updatedById`)
SELECT CONCAT('t', LEFT(MD5(CONCAT(t.`key`, '|', c.`id`)), 24)), c.`id`, t.`key`, t.`name`, t.`subjectAr`, t.`subjectEn`, t.`bodyAr`, t.`bodyEn`, t.`ctaLabelAr`, t.`ctaLabelEn`, t.`audience`, t.`active`, t.`version`, t.`updatedAt`, t.`updatedById`
FROM `email_templates` t CROSS JOIN `companies` c
WHERE t.`companyId` IS NULL;
DELETE FROM `email_templates` WHERE `companyId` IS NULL;

ALTER TABLE `email_templates` MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `companyId` VARCHAR(191) NOT NULL,
    ADD PRIMARY KEY (`id`);
CREATE UNIQUE INDEX `email_templates_companyId_key_key` ON `email_templates`(`companyId`, `key`);
ALTER TABLE `email_templates` ADD CONSTRAINT `email_templates_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────── e-mail triggers
ALTER TABLE `email_triggers` ADD COLUMN `companyId` VARCHAR(191) NULL;
DROP INDEX `email_triggers_processKey_status_active_idx` ON `email_triggers`;

INSERT INTO `email_triggers` (`id`, `companyId`, `processKey`, `status`, `templateKey`, `recipient`, `role`, `groupId`, `active`, `createdAt`, `createdById`, `ccEmails`)
SELECT CONCAT('g', LEFT(MD5(CONCAT(t.`id`, '|', c.`id`)), 24)), c.`id`, t.`processKey`, t.`status`, t.`templateKey`, t.`recipient`, t.`role`, t.`groupId`, t.`active`, t.`createdAt`, t.`createdById`, t.`ccEmails`
FROM `email_triggers` t CROSS JOIN `companies` c
WHERE t.`companyId` IS NULL;
DELETE FROM `email_triggers` WHERE `companyId` IS NULL;

ALTER TABLE `email_triggers` MODIFY `companyId` VARCHAR(191) NOT NULL;
CREATE INDEX `email_triggers_companyId_processKey_status_active_idx` ON `email_triggers`(`companyId`, `processKey`, `status`, `active`);
ALTER TABLE `email_triggers` ADD CONSTRAINT `email_triggers_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────── settings (key was the primary key)
ALTER TABLE `settings` DROP PRIMARY KEY,
    ADD COLUMN `id` VARCHAR(191) NULL,
    ADD COLUMN `companyId` VARCHAR(191) NULL;

INSERT INTO `settings` (`id`, `companyId`, `key`, `value`, `updatedAt`)
SELECT CONCAT('s', LEFT(MD5(CONCAT(s.`key`, '|', c.`id`)), 24)), c.`id`, s.`key`, s.`value`, s.`updatedAt`
FROM `settings` s CROSS JOIN `companies` c
WHERE s.`companyId` IS NULL;
DELETE FROM `settings` WHERE `companyId` IS NULL;

ALTER TABLE `settings` MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `companyId` VARCHAR(191) NOT NULL,
    ADD PRIMARY KEY (`id`);
CREATE UNIQUE INDEX `settings_companyId_key_key` ON `settings`(`companyId`, `key`);
ALTER TABLE `settings` ADD CONSTRAINT `settings_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
