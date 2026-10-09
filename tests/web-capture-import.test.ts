import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { KnowledgeStore } from "../src/server/store";

test("最新资料导入先完整校验、保留历史资料、备份且重复执行不重复入库", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shenbaotong-capture-"));
  const dbPath = path.join(root, "knowledge.sqlite");
  const captureFile = path.join(root, "capture.json");
  const manifestFile = path.join(root, "manifest.json");
  const text = "2026年测试竞赛规则：每队最多三人，必须为在校大学生。".repeat(10);
  const seed = new KnowledgeStore(dbPath);
  const old = seed.importDocument({ title: "历史政策", sourceUrl: "https://example.edu/policy", kind: "policy", year: "2023", stage: "学校", competition: "", fileName: "policy.txt", pages: [{ page: 1, text: "历史政策原文保留。" }] });
  seed.close();
  const entry = { catalogId: 5, title: "2026年测试竞赛规则", competition: "测试竞赛", year: "2026", kind: "rule", stage: "全国赛", captureFile, sourceUrl: "https://example.edu/2026/rule", yearAnchor: "2026年测试竞赛规则", textSha256: createHash("sha256").update(text).digest("hex") };
  writeFileSync(captureFile, JSON.stringify({ sourceUrl: entry.sourceUrl, pages: [{ page: null, text }] }));
  const manifest = (entries: unknown[]) => writeFileSync(manifestFile, JSON.stringify({ schemaVersion: 1, reviewedOn: "2026-10-09", entries }));
  const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("scripts/import-web-captures.ts"), manifestFile, ...args], { env: { ...process.env, RAG_DATA_DIR: root }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const inspect = () => { const store = new KnowledgeStore(dbPath); try { return { documents: store.listDocuments(), old: store.getDocument(old.document.id) }; } finally { store.close(); } };
  try {
    manifest([entry, { ...entry, textSha256: "bad" }]);
    assert.throws(() => run());
    assert.equal(inspect().documents.length, 1);
    manifest([{ ...entry, year: "2024—2026" }]);
    assert.throws(() => run());
    manifest([{ ...entry, sourceUrl: "https://example.edu/different" }]);
    assert.throws(() => run());
    manifest([entry]);
    assert.deepEqual(run("--dry-run"), { validated: 1, written: 0 });
    assert.equal(inspect().documents.length, 1);
    assert.equal(run().created, 1);
    const beforeRepeat = inspect();
    assert.equal(beforeRepeat.old?.chunks[0].text, "历史政策原文保留。");
    assert.ok(readdirSync(path.join(root, "backups")).length);
    assert.equal(run().duplicates, 1);
    assert.deepEqual(inspect(), beforeRepeat);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
