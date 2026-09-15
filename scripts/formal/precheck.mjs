import { execFileSync } from "node:child_process";
import { exactSha, remote } from "./remote.mjs";

const target = process.argv[2];
if (!exactSha(target)) throw new Error("target must be an exact lowercase 40-character SHA");
const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git(["status", "--porcelain", "--untracked-files=all"])) throw new Error("worktree must be clean");
if (git(["rev-parse", "HEAD"]) !== target) throw new Error("HEAD must equal target");
if (!git(["ls-remote", "origin"]).split("\n").some((line) => line.startsWith(target))) throw new Error("target is absent from origin");
const read = remote("set -euo pipefail; curl -fsS http://192.168.51.182:8000/api/version; echo; sudo -n k3s kubectl -n quarterly-recon get deployment quarterly-recon -o jsonpath='{.status.readyReplicas}/{.status.replicas} {.spec.template.spec.containers[0].image}'; echo; sudo -n k3s kubectl -n quarterly-recon get pods; docker exec quarterly-postgres psql -U postgres -d quarterly_recon -Atqc 'select string_agg(version, chr(44) order by version) from recon.schema_migrations'");
const version = JSON.parse(read.stdout.split("\n")[0]);
if (version.environment !== "formal" || !exactSha(version.buildSha)) throw new Error("formal version contract failed");
console.log(`FORMAL_PRECHECK=PASS\nTARGET_SHA=${target}\nCURRENT_FORMAL_SHA=${version.buildSha}\n${read.stdout.split("\n").slice(1).join("\n")}`);
