import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { reconciliationItems } from "../../../db/schema";

export async function GET() {
  try {
    const items = await getDb().select().from(reconciliationItems).orderBy(desc(reconciliationItems.id)).limit(100);
    return Response.json({ items });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "暂时无法读取记录" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { invoiceDate?: string; invoiceNumber?: string; amount?: string };
    const invoiceDate = body.invoiceDate?.trim() ?? "";
    const invoiceNumber = body.invoiceNumber?.trim() ?? "";
    const amount = body.amount?.trim() ?? "";
    if (!invoiceDate || !invoiceNumber || !amount || Number.isNaN(Number(amount))) return Response.json({ error: "请完整填写时间、发票号和金额" }, { status: 400 });
    const [item] = await getDb().insert(reconciliationItems).values({ invoiceDate, invoiceNumber, amount: Number(amount).toFixed(2) }).returning();
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存失败，请稍后重试" }, { status: 500 });
  }
}
