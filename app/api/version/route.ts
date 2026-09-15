// GET /api/version — reports the deployed git SHA and build metadata.
// buildSha must come from the build/deploy environment (BUILD_SHA), never hardcoded.
export const runtime = "nodejs";
import { readFile } from "node:fs/promises";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function GET() {
  const buildSha = process.env.BUILD_SHA ?? null;
  const buildTime = process.env.BUILD_TIME ?? null;
  const environment = process.env.ENVIRONMENT ?? "development";
  let sourceGitSha = process.env.SOURCE_GIT_SHA ?? null;
  try { sourceGitSha = JSON.parse(await readFile("/app/release-metadata.json", "utf8")).gitSha ?? sourceGitSha; } catch {}
  return Response.json({ buildSha, buildTime, environment, sourceGitSha }, { headers: corsHeaders });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
