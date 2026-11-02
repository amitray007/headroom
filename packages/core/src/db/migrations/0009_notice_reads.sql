CREATE TABLE `notice_reads` (
	`notice_id` text PRIMARY KEY NOT NULL,
	`read_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
