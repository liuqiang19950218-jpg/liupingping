// Source identity is bundled with the build, not supplied by runtime markers.
import metadata from "../../../lib/build-version.generated.mjs";
import { versionPayload } from "../../../lib/version-metadata.mjs";
export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

export async function GET() {
  try {
    const payload = versionPayload(metadata, process.env.BUILD_SHA);
    // A dev artifact must not masquerade as a deployed release.
    if (payload.releaseStatus === "unreleased" && ["formal", "staging"].includes(process.env.ENVIRONMENT ?? "")) throw new Error("Unreleased artifact");
    return Response.json(payload, { headers: corsHeaders });
  } catch {
    return Response.json({ sourceGitSha: null, buildTime: null, environment: metadata.environment, releaseId: null, buildSha: process.env.BUILD_SHA ?? null, releaseStatus: "invalid" }, { status: 503, headers: corsHeaders });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
