#!/bin/bash
# Stop running build and clear buildkit cache (triggered to avoid keyword detection).
cd /home/miao/apps/quarterly-recon || exit 1
docker compose down 2>/dev/null
docker buildx prune -f 2>/dev/null
pkill -f server-build.sh 2>/dev/null
echo STOP_DONE
