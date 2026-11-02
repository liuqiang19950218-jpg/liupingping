CREATE TABLE `reconciliation_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_date` text NOT NULL,
	`invoice_number` text NOT NULL,
	`amount` text NOT NULL,
	`status` text DEFAULT '待复核' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
