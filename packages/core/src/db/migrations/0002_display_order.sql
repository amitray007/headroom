CREATE TABLE `display_order` (
	`id` text PRIMARY KEY NOT NULL,
	`providers_json` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `position` integer;