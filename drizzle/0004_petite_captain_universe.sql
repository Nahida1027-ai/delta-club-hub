ALTER TABLE `orders` ADD `order_type` text DEFAULT 'escort' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `hours_half_units` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `hourly_rate_snapshot_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `price_menu` ADD `order_type` text DEFAULT 'escort' NOT NULL;--> statement-breakpoint
ALTER TABLE `price_menu` ADD `hourly_rate_cents` integer DEFAULT 0 NOT NULL;