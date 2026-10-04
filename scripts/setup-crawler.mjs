import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], {
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.resolve(process.env.RAG_DATA_DIR || "./data", "browser-runtime") },
});
process.exit(result.status ?? 1);
