#!/bin/bash
# Server-side build script, triggered by deploy pipeline.
cd /home/miao/apps/quarterly-recon || exit 1
rm -f deploy.tar deploy-pkg.tar.gz
docker compose up -d --build
