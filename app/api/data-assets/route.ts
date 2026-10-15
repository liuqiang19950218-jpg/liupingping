import { withPostgresClient } from "../../../db/postgres";
import { handleRouteError } from "../../../lib/server/recon/errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await withPostgresClient(async (client) => {
      const [summaryResult, coverageResult] = await Promise.all([
        client.query(`
          SELECT
            (SELECT count(*)::int FROM recon.customers) AS "customers",
            (SELECT count(*)::int FROM recon.reconciliations) AS "reconciliations",
            (SELECT count(*)::int FROM recon.difference_items) AS "differenceItems",
            (SELECT count(*)::int FROM recon.material_status) AS "materialStatus",
            (SELECT count(*)::int FROM recon.spd_dashboard_rows) AS "spdDashboardRows",
            (SELECT count(*)::int FROM recon.followup_items) AS "followupItems",
            (SELECT count(*)::int FROM recon.ledger_datasets) AS "ledgerDatasets",
            (SELECT count(*)::int FROM recon.ledger_invoices) AS "ledgerInvoices",
            (SELECT count(*)::int FROM recon.quarters) AS "quarters"
        `),
        client.query(`
          SELECT
            q.code AS "quarter",
            (SELECT count(*)::int FROM recon.reconciliations r WHERE r.quarter_id = q.id) AS "reconciliations",
            (SELECT count(*)::int
             FROM recon.difference_items d
             JOIN recon.reconciliations r ON r.id = d.reconciliation_id
             WHERE r.quarter_id = q.id) AS "differenceItems",
            (SELECT count(*)::int FROM recon.material_status m WHERE m.quarter_id = q.id) AS "materialStatus",
            (SELECT count(*)::int FROM recon.spd_dashboard_rows s WHERE s.quarter_id = q.id) AS "spdDashboardRows",
            (SELECT count(*)::int
             FROM recon.followup_items f
             JOIN recon.reconciliations r ON r.id = f.reconciliation_id
             WHERE r.quarter_id = q.id) AS "followupItems"
          FROM recon.quarters q
          ORDER BY q.year DESC, q.quarter DESC
        `),
      ]);

      return { summary: summaryResult.rows[0], quarterCoverage: coverageResult.rows };
    });
    return Response.json(payload);
  } catch (error) {
    return handleRouteError(error, {});
  }
}
