import { replaceHistoricalLedger } from "../../../../../lib/server/ledger/historical-import";
import { handleRouteError, readJsonBody, invalidInput } from "../../../../../lib/server/recon/errors";
import type { LedgerSourceFile } from "../../../../../lib/server/ledger/ledger";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// POST /api/ledger/historical/import
// Body: { sourceFiles: [{ sourceFileName, headers, rows }] } — one or more
// 历史往来 Excel files parsed by the browser. GLOBAL operation (not
// quarter-scoped). Creates a new HISTORICAL_BASE version, validates it, then
// atomically flips active from the old version to the new one. Old versions
// are never deleted. CURRENT_YEAR_QUARTER datasets are never touched.
export async function POST(request: Request) {
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
    const result = await replaceHistoricalLedger(files);
    return Response.json(result, { status: 201, headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
