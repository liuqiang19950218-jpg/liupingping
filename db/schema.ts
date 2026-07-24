import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const reconciliationItems = sqliteTable("reconciliation_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceDate: text("invoice_date").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  amount: text("amount").notNull(),
  status: text("status").notNull().default("待复核"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const quarters = sqliteTable("quarters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sourceFile: text("source_file").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ledgerLines = sqliteTable("ledger_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quarterId: integer("quarter_id").notNull(),
  accountSet: text("account_set").notNull(),
  customer: text("customer").notNull(),
  invoiceDate: text("invoice_date"),
  invoiceNumber: text("invoice_number"),
  amount: text("amount").notNull(),
});

export const quarterRows = sqliteTable("quarter_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quarterId: integer("quarter_id").notNull(),
  rowNumber: integer("row_number").notNull(),
  accountSet: text("account_set"),
  region: text("region"),
  customerName: text("customer_name"),
  rowData: text("row_data").notNull(),
});
