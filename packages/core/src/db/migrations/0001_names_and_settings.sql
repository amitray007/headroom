CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `display_name` text;