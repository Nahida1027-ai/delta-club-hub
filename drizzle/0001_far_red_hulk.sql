ALTER TABLE `orders` ADD `special_requirements_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `base_price_snapshot_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `special_total_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `total_price_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `order_original_total_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `orders`
SET
  `base_price_snapshot_cents` = CAST(ROUND(COALESCE(json_extract(`pricing_snapshot_json`, '$.base_price'), 0) * 100) AS integer),
  `total_price_cents` = CAST(ROUND(COALESCE(json_extract(`pricing_snapshot_json`, '$.base_price'), 0) * 100) AS integer),
  `order_original_total_cents` = CAST(ROUND(COALESCE(json_extract(`pricing_snapshot_json`, '$.base_price'), 0) * 100) AS integer)
WHERE `base_price_snapshot_cents` = 0;--> statement-breakpoint
ALTER TABLE `price_menu` ADD `commission_mode` text DEFAULT 'uniform' NOT NULL;--> statement-breakpoint
ALTER TABLE `price_menu` ADD `tier_commission_rates_json` text DEFAULT '{"1档":0,"2档":0,"3档":0}' NOT NULL;
