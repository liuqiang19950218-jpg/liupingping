// Create an immutable Git archive and provenance manifest; never deploys.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestPath, releaseIdentity, sourceFromGit, verifySourceTree } from './release-metadata.mjs';

export function prepareRelease({ cwd, environment, releaseId, archivePath, buildSha }) {
  const identity = releaseIdentity(environment, releaseId);
  const manifest = { ...sourceFromGit(cwd), ...identity };
  manifest.buildSha = buildSha ?? manifest.sourceGitSha;
  const destination = path.resolve(archivePath);
  if (destination.startsWith(`${path.resolve(cwd)}${path.sep}`)) throw new Error('Write release archives outside the source worktree');
  const temporary = mkdtempSync(path.join(tmpdir(), 'recon-release-'));
  try {
    const sourceTar = path.join(temporary, 'source.tar');
    const tree = path.join(temporary, 'tree');
    mkdirSync(tree);
    // Git for Windows can otherwise apply core.autocrlf while archiving.
    execFileSync('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar', `--output=${sourceTar}`, manifest.sourceGitSha], { cwd });
    execFileSync('tar', ['-xf', sourceTar, '-C', tree]);
    verifySourceTree(tree, manifest);
    mkdirSync(path.join(tree, '.release'));
    writeFileSync(path.join(tree, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync('tar', ['-czf', destination, '-C', tree, '.']);
    return { ...identity, sourceGitSha: manifest.sourceGitSha, archivePath: destination };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
    if (!option('--archive')) throw new Error('--archive outside the worktree is required');
    console.log(JSON.stringify(prepareRelease({ cwd: process.cwd(), environment: option('--environment'), releaseId: option('--release-id'), archivePath: option('--archive'), buildSha: process.env.BUILD_SHA })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
