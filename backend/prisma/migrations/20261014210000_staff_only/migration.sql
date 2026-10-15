-- Employees never sign in: the platform is for staff only.
-- Accounts from the short-lived self-service phase are switched off (kept for the record),
-- the EMPLOYEE role and its invitation e-mail are removed.
UPDATE `users` SET `active` = false WHERE `role` = 'EMPLOYEE';

DELETE FROM `user_assignments` WHERE `roleId` IN (SELECT `id` FROM `roles` WHERE `code` = 'EMPLOYEE');
DELETE FROM `roles` WHERE `code` = 'EMPLOYEE';

DELETE FROM `email_templates` WHERE `key` = 'employee.account_invitation';
