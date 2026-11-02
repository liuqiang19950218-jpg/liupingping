// GET /api/version — reports the deployed git SHA and build metadata.
// buildSha must come from the build/deploy environment (BUILD_SHA), never hardcoded.
export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function GET() {
  const buildSha = process.env.BUILD_SHA ?? null;
  const sourceGitSha = process.env.SOURCE_GIT_SHA ?? buildSha;
  const buildTime = process.env.BUILD_TIME ?? null;
  const environment = process.env.ENVIRONMENT ?? "development";
  return Response.json({ buildSha, sourceGitSha, buildTime, environment }, { headers: corsHeaders });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
