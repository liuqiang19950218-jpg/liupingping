CREATE TABLE `quarter_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quarter_id` integer NOT NULL,
	`row_number` integer NOT NULL,
	`account_set` text,
	`region` text,
	`customer_name` text,
	`row_data` text NOT NULL
);
