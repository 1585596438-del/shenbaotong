import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getStore } from "../src/server/store";
import { splitPages } from "../src/server/chunking";
import { publicUrl } from "../src/server/public-web";
import type { DocumentInput, PageText } from "../src/server/types";

type Entry = { catalogId: number; competition: string; title: string; year: string; kind: "notice" | "rule"; stage: string; captureFile: string; sourceUrl: string; textSha256: string; yearAnchor: string };
function required(value: unknown, name: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name}无效。`);
  return value;
}
async function main() {
  const file = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) || "docs/latest-competition-import-2026-10-09.json";
  const manifest = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  if (manifest.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.reviewedOn) || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 100) throw new Error("导入清单格式不正确。");
  const currentYear = Number(manifest.reviewedOn.slice(0, 4));
  const prepared: Array<{ entry: Entry; input: DocumentInput }> = [];
  // 全部来源校验完成后才打开知识库；中途缺失快照不会造成半次批量导入。
  for (const entry of manifest.entries as Entry[]) {
    if (!Number.isInteger(entry.catalogId) || entry.catalogId < 1 || entry.catalogId > 84 || !["notice", "rule"].includes(entry.kind)) throw new Error("赛事序号或资料类型无效。");
    for (const [key, max] of [["title", 160], ["competition", 160], ["stage", 80], ["year", 40], ["yearAnchor", 300], ["captureFile", 2000], ["sourceUrl", 2000]] as const) required(entry[key], key, max);
    const years = entry.year.match(/20\d{2}/g)?.map(Number) || [];
    if (!years.length || !years.every(year => year >= currentYear && year <= currentYear + 1)) throw new Error(`第${entry.catalogId}项不是已复核的当前或下一年度资料。`);
    publicUrl(entry.sourceUrl);
    const capture = JSON.parse((await readFile(path.resolve(entry.captureFile), "utf8")).replace(/^\uFEFF/, ""));
    if (capture.sourceUrl !== entry.sourceUrl || !Array.isArray(capture.pages) || !capture.pages.length || capture.pages.length > 50) throw new Error(`第${entry.catalogId}项来源或页码无效。`);
    const pages = capture.pages as PageText[];
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      if (!page || typeof page.text !== "string" || (page.page !== null && page.page !== index + 1)) throw new Error(`第${entry.catalogId}项正文或页序无效。`);
    }
    const text = pages.map(page => page.text).join("\n\n");
    if (text.trim().length < 100 || text.length > 1_000_000 || createHash("sha256").update(text).digest("hex") !== entry.textSha256 || !text.replace(/\s/g, "").includes(entry.yearAnchor.replace(/\s/g, ""))) throw new Error(`第${entry.catalogId}项正文校验值或年度依据不一致。`);
    splitPages(pages);
    prepared.push({ entry, input: { title: entry.title, competition: entry.competition, kind: entry.kind, year: entry.year, stage: entry.stage, sourceUrl: entry.sourceUrl, fileName: capture.fileName || "官方网页.txt", pages } });
  }
  if (process.argv.includes("--dry-run")) { console.log(JSON.stringify({ validated: prepared.length, written: 0 }, null, 2)); return; }
  const root = path.resolve(process.env.RAG_DATA_DIR || "data");
  await mkdir(path.join(root, "backups"), { recursive: true });
  let backup: string | null = null;
  if (existsSync(path.join(root, "knowledge.sqlite"))) {
    const existing = new Database(path.join(root, "knowledge.sqlite"), { readonly: true, fileMustExist: true });
    try { backup = path.join(root, "backups", `before-latest-import-${Date.now()}.sqlite`); await existing.backup(backup); }
    finally { existing.close(); }
  }
  const store = getStore();
  try {
    const before = store.listDocuments().length;
    const entries = prepared.map(({ entry, input }) => {
      const result = store.importDocument(input);
      return { catalogId: entry.catalogId, title: result.document.title, sourceUrl: result.document.sourceUrl, year: result.document.year, documentId: result.document.id, duplicate: result.duplicate, chunks: result.document.chunkCount };
    });
    const report = { importedAt: new Date().toISOString(), manifest: path.resolve(file), backup, documentsBefore: before, documentsAfter: store.listDocuments().length, created: entries.filter(entry => !entry.duplicate).length, duplicates: entries.filter(entry => entry.duplicate).length, entries };
    await writeFile(path.join(root, "latest-competition-import-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } finally { store.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "资料入库失败。"); process.exitCode = 1; });
