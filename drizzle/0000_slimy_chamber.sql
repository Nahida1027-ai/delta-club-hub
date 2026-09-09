CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_item_id` text NOT NULL,
	`assigned_worker_ids_json` text NOT NULL,
	`status` text NOT NULL,
	`tip_cents` integer DEFAULT 0 NOT NULL,
	`final_club_income_cents` integer,
	`final_worker_incomes_json` text DEFAULT '[]' NOT NULL,
	`pricing_snapshot_json` text NOT NULL,
	`settlement_token` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_completed_at` ON `orders` (`completed_at`);--> statement-breakpoint
CREATE TABLE `price_menu` (
	`id` text PRIMARY KEY NOT NULL,
	`service_name` text NOT NULL,
	`base_price_cents` integer NOT NULL,
	`club_commission_bps` integer DEFAULT 0 NOT NULL,
	`split_type` text NOT NULL,
	`tiered_ratios_json` text,
	`eligible_tiers_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tier` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`total_completed_orders` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
PRAGMA optimize;
