-- The application already stores quote and declined reservations, but a database
-- built only from the 2.3.1 migrations still has the original six statuses.
-- Append those two values. Existing rows stay as they are.
UPDATE `reservations` SET `reservation_status` = 'pending' WHERE `reservation_status` IS NULL;--> statement-breakpoint
ALTER TABLE `reservations` MODIFY COLUMN `reservation_status` enum('pending','confirmed','ongoing','completed','cancelled','rejected','quote','declined') NOT NULL DEFAULT 'pending';
