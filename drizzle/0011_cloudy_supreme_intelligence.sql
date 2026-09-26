ALTER TABLE `orders` ADD `worker_order_earnings_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `worker_tip_earnings_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `total_tip_earnings_cents` integer DEFAULT 0 NOT NULL;