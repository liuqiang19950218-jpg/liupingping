import { spawn } from "node:child_process";
import path from "node:path";

const command = path.join(
  process.cwd(),
  "node_modules",
  "vinext",
  "dist",
  "cli.js",
);

const child = spawn(process.execPath, [command, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
  },
});

child.on("error", (error) => {
  console.error(`[vinext] 启动失败：${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
