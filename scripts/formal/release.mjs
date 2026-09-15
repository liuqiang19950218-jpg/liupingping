import { execFileSync } from "node:child_process";
import { exactSha, requireApproval, remote } from "./remote.mjs";

const target = process.argv[2];
if (!exactSha(target)) throw new Error("target must be an exact lowercase 40-character SHA");
requireApproval();
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const release = `${stamp}-${target.slice(0, 12)}`;
// The server owns the worktree, runtime env, Docker/k3s tools, and DB credentials.
// This command intentionally never transmits DATABASE_URL or any other secret.
const command = `set -euo pipefail; root=/home/liupp/apps/quarterly-recon; release=$root/releases/${release}; test -z \"$(git -C $root status --porcelain)\"; mkdir -p \"$release\"; git -C $root fetch origin; git -C $root worktree add --detach \"$release/src\" ${target}; \"$release/src/scripts/formal/server-build.sh\" \"$release/src\" \"$(sudo k3s kubectl -n quarterly-recon get deploy quarterly-recon -o jsonpath='{.spec.template.spec.containers[0].image}')\"; docker exec quarterly-postgres pg_dump -U postgres -d quarterly_recon -Fc > \"$release/quarterly_recon.dump\"; sha256sum \"$release/quarterly_recon.dump\" > \"$release/quarterly_recon.dump.sha256\"; image=quarterly-recon:prod-${release}; docker build -f Dockerfile.offline --build-arg BASE_IMAGE=$(sudo k3s kubectl -n quarterly-recon get deploy quarterly-recon -o jsonpath='{.spec.template.spec.containers[0].image}') --build-arg BUILD_SHA=${target} --build-arg BUILD_TIME=${stamp} --build-arg ENVIRONMENT=formal -t \"$image\" .; docker save \"$image\" | sudo k3s ctr images import -; previous=$(sudo k3s kubectl -n quarterly-recon get deploy quarterly-recon -o jsonpath='{.spec.template.spec.containers[0].image}'); printf '%s' \"$previous\" > \"$release/previous-image.txt\"; sudo k3s kubectl -n quarterly-recon set image deploy/quarterly-recon web=\"$image\"; sudo k3s kubectl -n quarterly-recon rollout status deploy/quarterly-recon --timeout=420s`;
remote(command, { write: true });
console.log(`FORMAL_RELEASE_DISPATCHED=YES\nRELEASE=${release}\nTARGET_SHA=${target}`);
