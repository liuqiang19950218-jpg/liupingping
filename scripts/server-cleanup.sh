#!/bin/bash
# Full cleanup: stop project, remove all stale quarterly containers, then start.
cd /home/miao/apps/quarterly-recon
docker compose down --remove-orphans 2>/dev/null
# Remove every container whose name mentions quarterly (stale recreates)
docker ps -a --format '{{.Names}}' | grep -i quarterly | xargs -r docker rm -f 2>/dev/null
docker container prune -f 2>/dev/null
docker compose up -d
echo ===STATUS===
docker compose ps
echo ===PORT===
ss -tlnp 2>/dev/null | grep :3011 || echo NOT_READY
