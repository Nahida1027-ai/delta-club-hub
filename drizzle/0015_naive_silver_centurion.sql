ALTER TABLE `orders` ADD `original_total_before_discount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_amount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `override_commission_bps` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `override_discount_bps` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `custom_order_no` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `display_created_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `display_completed_at` text;--> statement-breakpoint
CREATE INDEX `idx_orders_display_created_at` ON `orders` (`display_created_at`);