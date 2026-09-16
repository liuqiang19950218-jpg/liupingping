import { withPostgresClient } from "../../../../db/postgres";
import { handleRouteError } from "../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const labels: Record<string, string> = {
  NEW_QUARTER_BASE: "新季度基础导入",
  REPLACE_QUARTER_BASE: "季度基础全量替换",
  UPDATE_COMPANY_RECEIVABLE: "公司应收增量更新",
};

export async function GET() {
  try {
    const result = await withPostgresClient((client) => client.query(
      "SELECT b.id::text, b.data_type, q.code quarter, b.original_file_name, b.source_sha256, b.imported_at, b.status, b.inserted_count, b.updated_count FROM recon.import_batches b JOIN recon.quarters q ON q.id=b.quarter_id WHERE b.data_type = ANY($1::text[]) ORDER BY b.imported_at DESC LIMIT 50",
      [Object.keys(labels)],
    ));
    return Response.json({ batches: result.rows.map((row) => ({ ...row, label: labels[String(row.data_type)] })) });
  } catch (error) {
    return handleRouteError(error, {});
  }
}
