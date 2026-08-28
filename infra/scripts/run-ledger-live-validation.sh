#!/bin/bash
# Phase 2G.1 ledger live validation runner.
# Sources the infra env as root (secret never embedded in this file), points
# DATABASE_URL at the isolated ledger test DB, then runs the tsx harness.
REPO=/home/liupp/ledger-2g1
cd "$REPO" || exit 1
sudo bash -c "set -a; source /opt/quarterly-recon-infra/.env; set +a
export DATABASE_URL=\"postgresql://\${APP_DB_USER}:\${APP_DB_PASSWORD}@127.0.0.1:5432/quarterly_recon_ledger_runtime_test_20260828\"
export PATH=/home/liupp/.hermes/node/bin:\$PATH
cd $REPO || exit 1
node --import tsx infra/scripts/ledger-live-validation.ts
"
