import { createHash, readFileSync } from "node:fs";
import { exactSha, requireApproval } from "./remote.mjs";

const path = process.argv[2];
if (!path) throw new Error("manifest path is required");
const manifest = JSON.parse(readFileSync(path, "utf8"));
for (const key of ["task_id", "source_file", "source_sha256", "target_scope", "script"]) if (!manifest[key]) throw new Error(`missing ${key}`);
if (!/^[a-f0-9]{64}$/.test(manifest.source_sha256) || !Number.isInteger(manifest.expected_rows) || manifest.expected_rows < 0 || manifest.requires_backup !== true) throw new Error("invalid hash, rows, or backup gate");
const actual = createHash("sha256").update(readFileSync(manifest.source_file)).digest("hex");
if (actual !== manifest.source_sha256) throw new Error("source hash mismatch");
if (!manifest.pre_checks || !manifest.post_checks || !manifest.transaction) throw new Error("PRE, transaction, and POST are required");
requireApproval();
console.log(`FORMAL_DATA_TASK_READY=YES\nTASK=${manifest.task_id}\nSCOPE=${manifest.target_scope}`);
