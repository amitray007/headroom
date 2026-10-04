CREATE TABLE `account_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`kind` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`metric_key` text,
	`detail_json` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_events_connection` ON `account_events` (`connection_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `auto_reset_rules` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`window` text NOT NULL,
	`threshold_percent` integer NOT NULL,
	`min_hours_left` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `spend_budgets` (
	`connection_id` text NOT NULL,
	`metric_key` text NOT NULL,
	`amount` real NOT NULL,
	`unit` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`connection_id`, `metric_key`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `account_actions` ADD `origin` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `wallet_top_ups` ADD `source` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `wallet_top_ups` ADD `expires_on` text;--> statement-breakpoint
ALTER TABLE `wallet_top_ups` ADD `expiry_alert_days` integer;