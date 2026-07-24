import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { quarterRows, quarters } from "../../../../db/schema";
import { readSession } from "../../auth/session";

async function requireAdmin(request: Request) {
  const user = await readSession(request.headers.get("cookie"));
  return user?.role === "admin" ? user : null;
}

export async function GET(request: Request) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "请先以管理员身份登录。" }, { status: 401 });
  const db = getDb();
  const list = await db.select().from(quarters).orderBy(desc(quarters.id));
  const selected = list[0];
  const rows = selected ? await db.select().from(quarterRows).where(eq(quarterRows.quarterId, selected.id)).orderBy(quarterRows.rowNumber) : [];
  return NextResponse.json({ quarters: list, quarter: selected ?? null, rows: rows.map((row) => ({ ...row, rowData: JSON.parse(row.rowData) })) });
}

export async function POST(request: Request) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "请先以管理员身份登录。" }, { status: 401 });
  const body = await request.json() as { name?: string; sourceFile?: string; headers?: string[]; rows?: unknown[][] };
  const name = body.name?.trim() ?? "";
  const sourceFile = body.sourceFile?.trim() ?? "";
  const headers = body.headers ?? [];
  const rows = body.rows ?? [];
  if (!name || !sourceFile || headers.length === 0 || rows.length === 0) return NextResponse.json({ error: "请完整选择季度表和文件。" }, { status: 400 });
  if (rows.length > 5000 || headers.length > 100) return NextResponse.json({ error: "导入表格过大，请联系管理员处理。" }, { status: 400 });
  const db = getDb();
  const [quarter] = await db.insert(quarters).values({ name, sourceFile }).returning();
  const indexOf = (label: string) => headers.indexOf(label);
  const accountIndex = indexOf("账套"); const regionIndex = indexOf("区域"); const customerIndex = indexOf("客户名称");
  const statements = rows.map((row, index) => env.DB.prepare("INSERT INTO quarter_rows (quarter_id, row_number, account_set, region, customer_name, row_data) VALUES (?, ?, ?, ?, ?, ?)").bind(quarter.id, index + 2, String(accountIndex >= 0 ? row[accountIndex] ?? "" : ""), String(regionIndex >= 0 ? row[regionIndex] ?? "" : ""), String(customerIndex >= 0 ? row[customerIndex] ?? "" : ""), JSON.stringify({ headers, values: row })));
  for (let start = 0; start < statements.length; start += 100) await env.DB.batch(statements.slice(start, start + 100));
  return NextResponse.json({ quarter, count: rows.length }, { status: 201 });
}
