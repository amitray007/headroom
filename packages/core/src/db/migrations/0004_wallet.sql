CREATE TABLE `wallet_costs` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`price_minor` integer,
	`price_currency` text,
	`cycle` text,
	`renews_on` text,
	`included_with` text,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wallet_top_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`price_minor` integer,
	`price_currency` text,
	`credits` real,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wallet_top_ups_date` ON `wallet_top_ups` (`date`);