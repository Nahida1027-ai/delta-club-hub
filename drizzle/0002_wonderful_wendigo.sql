ALTER TABLE `orders` ADD `split_type` text DEFAULT 'single' NOT NULL;--> statement-breakpoint
UPDATE `orders`
SET `split_type` = CASE
  WHEN json_extract(`pricing_snapshot_json`, '$.split_type') IN ('single', 'equal', 'tiered')
    THEN json_extract(`pricing_snapshot_json`, '$.split_type')
  ELSE 'single'
END;
