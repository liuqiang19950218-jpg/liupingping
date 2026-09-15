import { readFileSync } from "node:fs";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("usage: validate-data-manifest.mjs <manifest.json>");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const requiredStrings = ["taskId", "sourceSha256", "targetScope", "taskScript"];
for (const key of requiredStrings) {
  if (typeof manifest[key] !== "string" || manifest[key].trim() === "") throw new Error(`missing ${key}`);
}
if (!/^[a-f0-9]{64}$/.test(manifest.sourceSha256)) throw new Error("sourceSha256 must be lowercase SHA-256");
if (!Number.isInteger(manifest.expectedRows) || manifest.expectedRows < 0) throw new Error("expectedRows must be a non-negative integer");
for (const key of ["pre", "transaction", "post", "audit"]) {
  if (typeof manifest[key] !== "object" || manifest[key] === null || Array.isArray(manifest[key])) throw new Error(`missing object ${key}`);
}
console.log(`DATA_TASK_MANIFEST=VALID\nTASK_ID=${manifest.taskId}\nTARGET_SCOPE=${manifest.targetScope}\nEXPECTED_ROWS=${manifest.expectedRows}`);
