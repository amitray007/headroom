CREATE TABLE `account_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`provider_reference` text,
	`resulting_snapshot_id` text,
	`sanitized_error` text,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resulting_snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_actions_idempotency` ON `account_actions` (`connection_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`method` text NOT NULL,
	`state` text NOT NULL,
	`connection_id` text,
	`next_step` text,
	`next_step_payload` text,
	`private_ciphertext` blob,
	`private_nonce` blob,
	`key_version` integer,
	`sanitized_error` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_state` ON `auth_attempts` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `connection_capabilities` (
	`connection_id` text NOT NULL,
	`metric_or_action` text NOT NULL,
	`availability` text NOT NULL,
	`interface` text NOT NULL,
	`evidence_level` text NOT NULL,
	`reason` text,
	`checked_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `metric_or_action`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`workspace_id` text,
	`scope` text NOT NULL,
	`label` text NOT NULL,
	`auth_method` text NOT NULL,
	`state` text NOT NULL,
	`reconnect_reason` text,
	`last_success_at` integer,
	`interface` text NOT NULL,
	`connector_version` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_identity` ON `connections` (`provider`,`provider_account_id`,`workspace_id`,`scope`);--> statement-breakpoint
CREATE INDEX `connections_state` ON `connections` (`state`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`ciphertext` blob NOT NULL,
	`nonce` blob NOT NULL,
	`key_version` integer NOT NULL,
	`expires_at` integer,
	`refreshed_at` integer,
	`refresh_state` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `leases` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`provider_metric_key` text NOT NULL,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	`value_text` text,
	`value_num` real,
	`unit` text NOT NULL,
	`unlimited` integer DEFAULT false NOT NULL,
	`window_start` integer,
	`window_end` integer,
	`resets_at` integer,
	`availability` text NOT NULL,
	`interface` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `metrics_snapshot` ON `metrics` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `owner` (
	`id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reset_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`provider_credit_id` text NOT NULL,
	`eligible` integer NOT NULL,
	`usable` integer NOT NULL,
	`expires_at` integer,
	`cooldown_until` integer,
	`raw_label` text,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reset_credits_snapshot` ON `reset_credits` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owner`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`connector_version` text NOT NULL,
	`schema_version` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_connection` ON `snapshots` (`connection_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`outcome` text,
	`retry_after` integer,
	`sanitized_error` text,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_runs_connection` ON `sync_runs` (`connection_id`,`started_at`);