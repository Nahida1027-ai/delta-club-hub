DROP INDEX `idx_settlement_records_worker_period`;--> statement-breakpoint
CREATE INDEX `idx_settlement_records_worker_period` ON `settlement_records` (`worker_id`,`period_end`);--> statement-breakpoint
PRAGMA optimize;
