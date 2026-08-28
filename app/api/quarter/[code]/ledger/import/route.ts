import { importQuarterLedger, type LedgerSourceFile } from "../../../../../../lib/server/ledger/ledger";
import { withPostgresTransaction } from "../../../../../../db/postgres";
import { handleRouteError, readJsonBody, invalidInput } from "../../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string }> };

// POST /api/quarter/[code]/ledger/import
// Body: { sourceFiles: [{ sourceFileName, headers, rows }] }
// Import the current-year cumulative ledger for a quarter (one dataset per
// quarter; later quarters never overwrite earlier ones; same-quarter re-import
// is BLOCKED with 409 until the re-import policy is confirmed).
export async function POST(request: Request, context: RouteContext) {
  const { code } = await context.params;
  try {
    const body = await readJsonBody(request);
    const sourceFiles = body.sourceFiles;
    if (!Array.isArray(sourceFiles)) {
      throw invalidInput("请求体必须包含 sourceFiles 数组");
    }
    const files: LedgerSourceFile[] = sourceFiles.map((file) => {
      const item = (file ?? {}) as Record<string, unknown>;
      if (
        typeof item.sourceFileName !== "string" ||
        !Array.isArray(item.headers) ||
        !Array.isArray(item.rows)
      ) {
        throw invalidInput("每个 sourceFile 必须包含 sourceFileName/headers/rows");
      }
      return {
        sourceFileName: item.sourceFileName,
        headers: item.headers.map(String),
        rows: item.rows as unknown[][],
      };
    });
    const result = await withPostgresTransaction((client) =>
      importQuarterLedger(client, code, files),
    );
    return Response.json(result, { status: 201, headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
