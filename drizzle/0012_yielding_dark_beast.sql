ALTER TABLE `orders` ADD `transfer_fees_by_worker_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `reassignment_history_json` text DEFAULT '[]' NOT NULL;