import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { prepareBuild, sourceFromGit, verifySourceTree, generatedPath, manifestPath } from '../scripts/release-metadata.mjs';
import { prepareRelease } from '../scripts/prepare-release.mjs';
import { versionPayload, validateReleaseMetadata } from '../lib/version-metadata.mjs';

const sample = { sourceGitSha: 'a'.repeat(40), buildTime: '2026-11-02T00:00:00.000Z', environment: 'formal', releaseId: 'formal-20261102-01', buildSha: 'legacy-marker' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'recon-version-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'repo');
  mkdirSync(path.join(cwd, 'app/api/version'), { recursive: true });
  mkdirSync(path.join(cwd, 'lib'));
  writeFileSync(path.join(cwd, 'app/api/version/route.mjs'), readFileSync(new URL('../app/api/version/route.ts', import.meta.url)));
  writeFileSync(path.join(cwd, 'lib/version-metadata.mjs'), readFileSync(new URL('../lib/version-metadata.mjs', import.meta.url)));
  writeFileSync(path.join(cwd, '.gitignore'), `/${generatedPath}\n/.release/\n/node_modules/\n`);
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.name', 'Version test');
  git(cwd, 'config', 'user.email', 'version-test@example.invalid');
  git(cwd, 'config', 'core.autocrlf', 'false');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'Fixture build source');
  return { root, cwd, sha: git(cwd, 'rev-parse', 'HEAD') };
}

test('four version fields and legacy marker remain distinct', () => {
  const result = versionPayload(sample, 'runtime-marker');
  assert.equal(result.sourceGitSha, sample.sourceGitSha);
  assert.equal(result.buildTime, sample.buildTime);
  assert.equal(result.environment, 'formal');
  assert.equal(result.releaseId, sample.releaseId);
  assert.equal(result.buildSha, 'runtime-marker');
  assert.equal(result.releaseStatus, 'released');
});

test('formal and staging never fall back to BUILD_SHA for invalid source identity', () => {
  for (const environment of ['formal', 'staging']) {
    for (const sourceGitSha of [null, undefined, '', 'abc1234', 'g'.repeat(40)]) {
      assert.throws(() => versionPayload({ ...sample, environment, sourceGitSha }, 'a'.repeat(40)), /SOURCE_GIT_SHA/);
    }
  }
});

test('reject invalid release IDs, environment and time', () => {
  for (const releaseId of ['', 'a'.repeat(40), '../../release', 'bad\nvalue']) assert.throws(() => validateReleaseMetadata({ ...sample, releaseId }), /RELEASE_ID/);
  assert.throws(() => validateReleaseMetadata({ ...sample, environment: 'production' }), /ENVIRONMENT/);
  assert.throws(() => validateReleaseMetadata({ ...sample, buildTime: 'old-marker' }), /BUILD_TIME/);
});

test('actual Git HEAD is derived automatically, old BUILD_TIME is ignored', (t) => {
  const { cwd, sha } = fixture(t);
  const before = Date.now();
  const result = prepareBuild(cwd, { ENVIRONMENT: 'staging', BUILD_SHA: 'keep-marker', BUILD_TIME: '2000-01-01T00:00:00Z' });
  assert.equal(result.sourceGitSha, sha);
  assert.equal(result.buildSha, 'keep-marker');
  assert.ok(Date.parse(result.buildTime) >= before && Date.parse(result.buildTime) <= Date.now());
  assert.match(result.releaseId, /^staging-/);
});

test('SOURCE_GIT_SHA is an assertion against actual HEAD, never an input override', (t) => {
  const { cwd, sha } = fixture(t);
  for (const source of ['', 'short', 'b'.repeat(40)]) assert.throws(() => prepareBuild(cwd, { ENVIRONMENT: 'formal', SOURCE_GIT_SHA: source }), /SOURCE_GIT_SHA/);
  assert.equal(prepareBuild(cwd, { ENVIRONMENT: 'formal', SOURCE_GIT_SHA: sha }).sourceGitSha, sha);
});

test('dirty tracked, staged and untracked source all block release', (t) => {
  const { cwd } = fixture(t);
  const file = path.join(cwd, 'lib/version-metadata.mjs');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n// changed\n`);
  assert.throws(() => sourceFromGit(cwd), /clean committed/);
  git(cwd, 'add', '.');
  assert.throws(() => sourceFromGit(cwd), /clean committed/);
  git(cwd, 'commit', '-qm', 'Fixture edit');
  writeFileSync(path.join(cwd, 'app/extra.mjs'), 'export default 1;');
  assert.throws(() => sourceFromGit(cwd), /clean committed/);
});

test('Git archive preserves source SHA without .git and detects tampering/extra source', (t) => {
  const { root, cwd, sha } = fixture(t);
  const archivePath = path.join(root, 'release.tgz');
  // Match Windows developer configuration; the archive must still use Git bytes.
  git(cwd, 'config', 'core.autocrlf', 'true');
  prepareRelease({ cwd, archivePath, environment: 'formal', releaseId: 'formal-test' });
  const extracted = path.join(root, 'extracted');
  mkdirSync(extracted);
  execFileSync('tar', ['-xzf', archivePath, '-C', extracted]);
  const metadata = prepareBuild(extracted, {});
  assert.equal(metadata.sourceGitSha, sha);
  assert.equal(metadata.environment, 'formal');
  assert.equal(metadata.releaseId, 'formal-test');
  assert.throws(() => prepareBuild(extracted, { ENVIRONMENT: 'staging' }), /identity differs/);
  assert.throws(() => prepareBuild(extracted, { ENVIRONMENT: 'development' }), /cannot be relabeled/);
  assert.throws(() => prepareBuild(extracted, { SOURCE_GIT_SHA: 'b'.repeat(40) }), /SOURCE_GIT_SHA/);
  const extra = path.join(extracted, 'app/inherited.mjs');
  writeFileSync(extra, 'export default 1;');
  assert.throws(() => prepareBuild(extracted, {}), /inherited file/);
  rmSync(extra);
  writeFileSync(path.join(extracted, 'lib/version-metadata.mjs'), 'tampered');
  assert.throws(() => prepareBuild(extracted, {}), /differs from Git manifest/);
});

test('release without Git or a valid source manifest is blocked', (t) => {
  const { root } = fixture(t);
  const missing = path.join(root, 'missing');
  mkdirSync(missing);
  assert.throws(() => prepareBuild(missing, { ENVIRONMENT: 'formal', SOURCE_GIT_SHA: sample.sourceGitSha }));
  mkdirSync(path.join(missing, '.release'));
  writeFileSync(path.join(missing, manifestPath), JSON.stringify({ environment: 'formal', sourceGitSha: 'old-marker' }));
  assert.throws(() => prepareBuild(missing, {}), /Invalid source manifest/);
});

test('manifest paths cannot traverse outside the source directory', (t) => {
  const { cwd } = fixture(t);
  assert.throws(() => verifySourceTree(cwd, { schemaVersion: 1, sourceGitSha: sample.sourceGitSha, files: { '../escape': 'anything' } }), /Unsafe manifest path/);
});

test('source manifests support application assets larger than the child-process default buffer', (t) => {
  const { cwd } = fixture(t);
  writeFileSync(path.join(cwd, 'large-asset.bin'), Buffer.alloc(2 * 1024 * 1024, 42));
  git(cwd, 'add', 'large-asset.bin');
  git(cwd, 'commit', '-qm', 'Large asset fixture');
  const manifest = sourceFromGit(cwd);
  assert.match(manifest.files['large-asset.bin'], /^[0-9a-f]{64}$/);
  verifySourceTree(cwd, manifest);
});

test('development is explicitly unreleased even with an old marker', (t) => {
  const { cwd } = fixture(t);
  const result = versionPayload(prepareBuild(cwd, { BUILD_SHA: sample.sourceGitSha, SOURCE_GIT_SHA: sample.sourceGitSha }));
  assert.equal(result.sourceGitSha, null);
  assert.equal(result.environment, 'development');
  assert.equal(result.releaseId, null);
  assert.equal(result.releaseStatus, 'unreleased');
});

test('real route GET/OPTIONS uses build commit, ignores runtime source override and preserves CORS', async (t) => {
  const { cwd, sha } = fixture(t);
  const built = prepareBuild(cwd, { ENVIRONMENT: 'staging', RELEASE_ID: 'staging-route-test' });
  const routeUrl = pathToFileURL(path.join(cwd, 'app/api/version/route.mjs')).href;
  const program = `const {GET,OPTIONS}=await import(${JSON.stringify(routeUrl)}); const r=await GET(); console.log(JSON.stringify({status:r.status,body:await r.json(),cors:r.headers.get('access-control-allow-origin'),cache:r.headers.get('cache-control'),options:OPTIONS().status}));`;
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', program], { env: { ...process.env, SOURCE_GIT_SHA: 'b'.repeat(40), BUILD_SHA: 'runtime-old-marker', BUILD_TIME: 'old', ENVIRONMENT: 'staging' } });
  const response = JSON.parse(raw.toString());
  assert.equal(response.status, 200);
  assert.equal(response.body.sourceGitSha, sha);
  assert.equal(response.body.buildTime, built.buildTime);
  assert.equal(response.body.environment, 'staging');
  assert.equal(response.body.releaseId, 'staging-route-test');
  assert.equal(response.body.buildSha, 'runtime-old-marker');
  assert.equal(response.cors, '*');
  assert.equal(response.cache, 'no-store');
  assert.equal(response.options, 204);
});

test('real route rejects a development artifact relabeled as formal', (t) => {
  const { cwd } = fixture(t);
  prepareBuild(cwd, {});
  const routeUrl = pathToFileURL(path.join(cwd, 'app/api/version/route.mjs')).href;
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', `const {GET}=await import(${JSON.stringify(routeUrl)});const r=await GET();console.log(JSON.stringify({status:r.status,body:await r.json()}));`], { env: { ...process.env, ENVIRONMENT: 'formal', BUILD_SHA: 'a'.repeat(40) } });
  const response = JSON.parse(raw.toString());
  assert.equal(response.status, 503);
  assert.equal(response.body.sourceGitSha, null);
  assert.equal(response.body.releaseStatus, 'invalid');
});
