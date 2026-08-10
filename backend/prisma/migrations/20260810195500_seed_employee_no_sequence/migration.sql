-- Seed the employee-number sequence from the numbers already handed out,
-- so the first allocation after this deploy continues where count()+1
-- left off instead of restarting at EMP-0001.
INSERT INTO `sequences` (`key`, `value`)
SELECT 'EMPLOYEE_NO', COUNT(*) FROM `employees` WHERE `employeeNo` IS NOT NULL
ON DUPLICATE KEY UPDATE `value` = GREATEST(`sequences`.`value`, VALUES(`value`));
