export const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/i;
export const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validateReleaseMetadata(metadata) {
  if (!['staging', 'formal'].includes(metadata.environment)) throw new Error('Release ENVIRONMENT must be staging or formal');
  if (!SOURCE_SHA_PATTERN.test(metadata.sourceGitSha ?? '')) throw new Error('SOURCE_GIT_SHA must be a full 40-character Git SHA');
  if (!RELEASE_ID_PATTERN.test(metadata.releaseId ?? '') || SOURCE_SHA_PATTERN.test(metadata.releaseId)) throw new Error('RELEASE_ID must be an independent release identifier, not a Git SHA');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(metadata.buildTime ?? '') || !Number.isFinite(Date.parse(metadata.buildTime))) throw new Error('BUILD_TIME must be the actual ISO UTC build time');
  return metadata;
}

export function versionPayload(metadata, legacyBuildSha) {
  if (metadata.environment === 'development' && metadata.releaseStatus === 'unreleased') {
    return { sourceGitSha: null, buildTime: metadata.buildTime, environment: 'development', releaseId: null, buildSha: legacyBuildSha ?? metadata.buildSha ?? null, releaseStatus: 'unreleased' };
  }
  validateReleaseMetadata(metadata);
  return { sourceGitSha: metadata.sourceGitSha, buildTime: metadata.buildTime, environment: metadata.environment, releaseId: metadata.releaseId, buildSha: legacyBuildSha ?? metadata.buildSha ?? null, releaseStatus: 'released' };
}
