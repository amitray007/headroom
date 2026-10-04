CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`include_identity` integer DEFAULT false NOT NULL,
	`config_ciphertext` blob NOT NULL,
	`config_nonce` blob NOT NULL,
	`key_version` integer NOT NULL,
	`label` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`channel_id` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`failure` text,
	`first_attempt_at` integer NOT NULL,
	`last_attempt_at` integer NOT NULL,
	`next_attempt_at` integer,
	`delivered_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_event` ON `notification_deliveries` (`channel_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_recent` ON `notification_deliveries` (`channel_id`,`last_attempt_at`);