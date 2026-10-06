import { readFile } from "node:fs/promises";
import { getStore } from "../src/server/store";
import { seedCompetitionRules, validateSeedManifest } from "../src/server/competitions/seed";

async function main() {
  const file = process.argv[2] || "docs/competition-rule-seeds-2026-10-05.json";
  const manifest = validateSeedManifest(JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")));
  const store = getStore();
  try {
    const report = seedCompetitionRules(store, manifest);
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length) process.exitCode = 1;
  } finally { store.close(); }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "规则草稿录入失败。");
  process.exitCode = 1;
});
