import { resolveLedgerInvoices } from "../../../../../../lib/server/ledger/ledger";
import { withPostgresClient } from "../../../../../../db/postgres";
import { handleRouteError, readJsonBody } from "../../../../../../lib/server/recon/errors";

export const runtime = "nodejs";
const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
type Context = { params: Promise<{ code: string }> };

// POST only reads the active ledger datasets. It deliberately does not accept
// reconciliation ids, images, amounts, dates, or any write payload.
export async function POST(request: Request, context: Context) {
  const { code } = await context.params;
  try {
    const body = await readJsonBody(request);
    return Response.json({ results: await withPostgresClient((client) => resolveLedgerInvoices(client, code, body.invoiceNumbers)) }, { headers });
  } catch (error) { return handleRouteError(error, headers); }
}
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
