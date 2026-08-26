CREATE TABLE `ledger_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quarter_id` integer NOT NULL,
	`account_set` text NOT NULL,
	`customer` text NOT NULL,
	`invoice_date` text,
	`invoice_number` text,
	`amount` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quarters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`source_file` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
