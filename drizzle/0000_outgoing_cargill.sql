CREATE TABLE `market_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`commodity` text NOT NULL,
	`value` real NOT NULL,
	`change` real,
	`unit` text NOT NULL,
	`source` text NOT NULL,
	`provider` text NOT NULL,
	`observed_at` text NOT NULL,
	`collected_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_snapshots_commodity_observed_unique` ON `market_snapshots` (`commodity`,`observed_at`);--> statement-breakpoint
CREATE INDEX `market_snapshots_commodity_observed_idx` ON `market_snapshots` (`commodity`,`observed_at`);