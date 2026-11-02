// Typed API errors for the PostgreSQL runtime write layer.
// Write routes translate these into JSON responses with explicit status codes:
//   400 INVALID_INPUT  – malformed input, invalid amounts/status/category
//   404 NOT_FOUND      – quarter / reconciliation / child item does not exist
//   409 CONFLICT       – business conflict (e.g. cross-quarter target, duplicate)
//   500 INTERNAL       – server / database error (message never leaks to browser)
import { sanitizePostgresError } from "../../../db/postgres";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const invalidInput = (message: string) =>
  new ApiError(400, "INVALID_INPUT", message);
export const notFound = (message: string) =>
  new ApiError(404, "NOT_FOUND", message);
export const conflict = (message: string) =>
  new ApiError(409, "CONFLICT", message);

export type CorsHeaders = Record<string, string>;

// Unknown errors are logged server-side but only a generic message reaches the
// browser, so raw SQL / table structure / connection details never leak.
export function handleRouteError(error: unknown, headers: CorsHeaders) {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers },
    );
  }
  console.error("[write-api] unhandled error:", error);
  const sanitized = sanitizePostgresError(error);
  console.error("[write-api] sanitized:", sanitized);
  return Response.json(
    { error: "服务器内部错误", code: "INTERNAL" },
    { status: 500, headers },
  );
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw invalidInput("请求体必须是合法 JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalidInput("请求体必须是 JSON 对象");
  }
  return raw as Record<string, unknown>;
}
