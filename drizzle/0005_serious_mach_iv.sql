CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `price_menu` ADD `folder_id` text;--> statement-breakpoint
ALTER TABLE `price_menu` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `worker_type` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `sort_order` integer DEFAULT 0 NOT NULL;