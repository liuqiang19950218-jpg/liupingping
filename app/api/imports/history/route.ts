import { withPostgresClient } from "../../../../db/postgres";
import { handleRouteError } from "../../../../lib/server/recon/errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await withPostgresClient((client) => client.query(
      `SELECT
         b.id::text AS "id",
         b.data_type AS "dataType",
         q.code AS "quarter",
         b.original_file_name AS "fileName",
         b.source_sha256 AS "sourceSha256",
         b.imported_at AS "importedAt",
         u.display_name AS "operator",
         b.valid_record_count AS "validRecordCount",
         b.inserted_count AS "insertedCount",
         b.updated_count AS "updatedCount",
         b.skipped_count AS "skippedCount",
         b.error_count AS "errorCount",
         b.target_module AS "targetModule",
         b.status AS "status",
         b.details AS "details"
       FROM recon.import_batches b
       LEFT JOIN recon.quarters q ON q.id = b.quarter_id
       LEFT JOIN recon.users u ON u.id = b.imported_by
       ORDER BY b.imported_at DESC NULLS LAST, b.created_at DESC`,
    ));
    return Response.json({ batches: result.rows });
  } catch (error) {
    return handleRouteError(error, {});
  }
}
