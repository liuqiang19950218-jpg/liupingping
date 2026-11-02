import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SOURCE_SHA_PATTERN, RELEASE_ID_PATTERN, validateReleaseMetadata } from '../lib/version-metadata.mjs';

export const generatedPath = 'lib/build-version.generated.mjs';
export const manifestPath = '.release/source-manifest.json';
const excludedRoots = new Set(['.git', 'node_modules', 'dist', '.wrangler', '.cache', '.vinext', '.next', 'coverage']);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

export function sourceFromGit(cwd) {
  const sourceGitSha = git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim();
  if (!SOURCE_SHA_PATTERN.test(sourceGitSha)) throw new Error('Invalid actual Git HEAD');
  if (git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']).length) throw new Error('Release requires a clean committed worktree, including untracked files');
  const entries = git(cwd, ['ls-tree', '-rz', '--full-tree', sourceGitSha]).toString().split('\0').filter(Boolean);
  const files = {};
  for (const entry of entries) {
    const [header, filename] = entry.split('\t');
    const [mode, type, oid] = header.split(' ');
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error(`Unsupported release entry: ${filename}`);
    files[filename] = digest(git(cwd, ['cat-file', 'blob', oid]));
  }
  return { schemaVersion: 1, sourceGitSha, files };
}

export function verifySourceTree(cwd, manifest) {
  if (manifest.schemaVersion !== 1 || !SOURCE_SHA_PATTERN.test(manifest.sourceGitSha ?? '') || !manifest.files || !Object.keys(manifest.files).length) throw new Error('Invalid source manifest');
  for (const [filename, expected] of Object.entries(manifest.files)) {
    if (filename.includes('\\') || path.posix.isAbsolute(filename) || filename.split('/').some((part) => part === '..' || part === '') || /^[A-Za-z]:/.test(filename)) throw new Error('Unsafe manifest path');
    const absolute = path.join(cwd, filename);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile() || digest(readFileSync(absolute)) !== expected) throw new Error(`Source differs from Git manifest: ${filename}`);
  }
  function walk(relative = '') {
    for (const entry of readdirSync(path.join(cwd, relative), { withFileTypes: true })) {
      const filename = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relative && excludedRoots.has(entry.name)) continue;
      if (filename === manifestPath || filename === generatedPath || filename === 'next-env.d.ts' || filename === 'tsconfig.tsbuildinfo') continue;
      if (entry.isDirectory()) walk(filename);
      else if (!(filename in manifest.files)) throw new Error(`Untracked/inherited file in release source: ${filename}`);
    }
  }
  walk();
}

export function releaseIdentity(environment, releaseId) {
  if (!['staging', 'formal'].includes(environment)) throw new Error('Release ENVIRONMENT must be staging or formal');
  const id = releaseId || `${environment}-${new Date().toISOString().replace(/[-:.]/g, '')}`;
  if (!RELEASE_ID_PATTERN.test(id) || SOURCE_SHA_PATTERN.test(id)) throw new Error('Invalid independent RELEASE_ID');
  return { environment, releaseId: id };
}

export function prepareBuild(cwd, env = process.env) {
  const archive = existsSync(path.join(cwd, manifestPath)) ? JSON.parse(readFileSync(path.join(cwd, manifestPath), 'utf8')) : null;
  const environment = env.ENVIRONMENT || archive?.environment || 'development';
  let metadata;
  if (environment === 'development') {
    if (archive) throw new Error('A release archive cannot be relabeled as development');
    metadata = { sourceGitSha: null, buildTime: new Date().toISOString(), environment, releaseId: null, buildSha: env.BUILD_SHA ?? null, releaseStatus: 'unreleased' };
  } else {
    const manifest = archive || sourceFromGit(cwd);
    if (archive && existsSync(path.join(cwd, '.git'))) {
      const actual = git(cwd, ['rev-parse', 'HEAD']).toString().trim();
      if (actual !== archive.sourceGitSha) throw new Error('Archive source SHA does not match actual Git HEAD');
    }
    if (env.SOURCE_GIT_SHA !== undefined && (!SOURCE_SHA_PATTERN.test(env.SOURCE_GIT_SHA) || env.SOURCE_GIT_SHA !== manifest.sourceGitSha)) throw new Error('SOURCE_GIT_SHA differs from the verified build commit');
    if (archive && (environment !== archive.environment || (env.RELEASE_ID && env.RELEASE_ID !== archive.releaseId))) throw new Error('Release identity differs from archive');
    verifySourceTree(cwd, manifest);
    metadata = validateReleaseMetadata({ ...releaseIdentity(environment, env.RELEASE_ID || archive?.releaseId), sourceGitSha: manifest.sourceGitSha, buildTime: new Date().toISOString(), buildSha: env.BUILD_SHA ?? archive?.buildSha ?? manifest.sourceGitSha, releaseStatus: 'released' });
  }
  mkdirSync(path.join(cwd, 'lib'), { recursive: true });
  writeFileSync(path.join(cwd, generatedPath), `// Generated at build time; never edit or commit.\nexport default ${JSON.stringify(metadata, null, 2)};\n`);
  return metadata;
}
