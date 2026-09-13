ALTER TABLE `folders` ADD `parent_id` text;--> statement-breakpoint
CREATE INDEX `idx_folders_parent_order` ON `folders` (`parent_id`,`sort_order`);