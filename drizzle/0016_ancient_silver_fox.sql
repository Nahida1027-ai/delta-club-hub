ALTER TABLE `orders` ADD `manual_sort_index` integer;--> statement-breakpoint
CREATE INDEX `idx_orders_manual_sort_index` ON `orders` (`manual_sort_index`);--> statement-breakpoint
ALTER TABLE `settlement_records` ADD `manual_sort_index` integer;--> statement-breakpoint
CREATE INDEX `idx_settlement_records_manual_sort_index` ON `settlement_records` (`manual_sort_index`);