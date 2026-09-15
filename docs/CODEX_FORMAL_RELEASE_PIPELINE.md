# Codex Formal Release Pipeline

This directory is the future formal-release entrypoint, not permission to deploy now. Every mutating stage requires both `FORMAL_RELEASE_APPROVED=YES` and `FORMAL_RELEASE_ENV=formal`. The command also requires an exact SHA which is the clean worktree `HEAD`, exists on `origin`, and descends from the SHA presently returned by formal `/api/version`.

## Commands

```bash
FORMAL_RELEASE_APPROVED=YES FORMAL_RELEASE_ENV=formal FORMAL_SSH_TARGET=user@host \
  ./scripts/formal/release.sh <exact-40-character-sha>

FORMAL_RELEASE_APPROVED=YES FORMAL_RELEASE_ENV=formal FORMAL_SSH_TARGET=user@host \
  ./scripts/formal/data-task.sh path/to/manifest.json
```

`release.sh` runs the local quality gate, snapshots formal PostgreSQL and the live Deployment, accepts only newly-added numbered Git migrations, builds `quarterly-recon:prod-<UTC timestamp>-<short SHA>` on the server, imports it into k3s containerd, rolls out `quarterly-recon`, and verifies `Ready 1/1`, logs, `/api/version`, and `recon.schema_migrations`.

The formal deployment must already reference `quarterly-recon-data-secrets:DATABASE_URL`; the pipeline checks that reference and never reads, prints, archives, or writes the secret. It never accepts an injected `DATABASE_URL`, so a staging connection cannot be copied into formal.

## Data tasks

Business data is not committed to Git. A data-task manifest names a versioned task runner and requires a SHA-256 source hash, exact target scope, expected rows, PRE, transaction, POST, and audit sections. The runner is deliberately an explicit future Git implementation under `scripts/data-tasks/`; this pipeline does not invent an importer or execute a manifest without that audited code.

## Rollback

The backup captures the prior image and Deployment manifest before migration or rollout. If runtime checks fail, stop the release, preserve the new PostgreSQL state for diagnosis, and use the recorded prior image for a runtime rollback. No automatic destructive database rollback is provided.

## Required execution-time gates

Multi-browser verification remains a human/browser gate: two independent browser contexts must load the same formal URL, quarter, data and build SHA, then repeat after refresh and reopening. Emit `MULTI_BROWSER_SOURCE_OF_TRUTH=PASS` only after that proof. The future final rebase must use the then-current formal Git SHA after Hermes completes Phase 2K.11.
