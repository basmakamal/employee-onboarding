-- Each company works in its own local time: a punch, a leave day or a deadline
-- falls on the company's local date. Existing companies are in Saudi Arabia.
ALTER TABLE `companies` ADD COLUMN `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Riyadh';
