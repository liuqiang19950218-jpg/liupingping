import { verifyLedgerInvoice } from "../../../../../../lib/server/ledger/ledger";
import { withPostgresClient } from "../../../../../../db/postgres";
import { handleRouteError, readJsonBody } from "../../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string }> };

// POST /api/quarter/[code]/ledger/verify
// Body: { invoiceNo, invoiceDate, amount }
// Server-authoritative verification against active HISTORICAL_BASE UNION the
// quarter's CURRENT_YEAR_QUARTER dataset. Never returns the full dataset — only
// the match decision + dataset provenance.
export async function POST(request: Request, context: RouteContext) {
  const { code } = await context.params;
  try {
    const body = await readJsonBody(request);
    const result = await withPostgresClient((client) =>
      verifyLedgerInvoice(client, code, {
        invoiceNo: body.invoiceNo,
        invoiceDate: body.invoiceDate,
        amount: body.amount,
      }),
    );
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
