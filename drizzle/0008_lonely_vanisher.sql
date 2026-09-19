CREATE TABLE `settlement_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`settlement_record_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_settlement_periods_worker_status` ON `settlement_periods` (`worker_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlement_periods_one_active_worker` ON `settlement_periods` (`worker_id`) WHERE "settlement_periods"."status" = 'active';--> statement-breakpoint
ALTER TABLE `orders` ADD `settlement_period_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `settlement_period_ids_by_worker_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `settlement_records` ADD `period_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `settlement_reminder_hours` integer DEFAULT 72 NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `active_period_id` text;--> statement-breakpoint
PRAGMA optimize;
