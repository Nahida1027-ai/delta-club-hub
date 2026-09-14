CREATE TABLE `settlement_records` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`worker_name_snapshot` text NOT NULL,
	`worker_type_snapshot` text DEFAULT 'standard' NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`order_ids_json` text DEFAULT '[]' NOT NULL,
	`order_details_json` text DEFAULT '[]' NOT NULL,
	`total_orders` integer DEFAULT 0 NOT NULL,
	`total_amount_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_at` integer,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_settlement_records_status_end` ON `settlement_records` (`status`,`period_end`);--> statement-breakpoint
CREATE INDEX `idx_settlement_records_worker_status` ON `settlement_records` (`worker_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlement_records_worker_period` ON `settlement_records` (`worker_id`,`period_end`);--> statement-breakpoint
ALTER TABLE `orders` ADD `settled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `settlement_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `settlement_ids_by_worker_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `joined_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `settlement_interval_days` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `settlement_time` text DEFAULT '20:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `last_settled_at` integer;--> statement-breakpoint
ALTER TABLE `workers` ADD `next_settlement_at` integer;--> statement-breakpoint
PRAGMA optimize;
