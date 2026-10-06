import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { competitionFixture } from "./helpers/competition-fixture";
import { findAnchorChunks, seedCompetitionRules, validateSeedManifest, type SeedManifest } from "../src/server/competitions/seed";

function manifest(text = "同校学生最多3人。"): SeedManifest {
  return { schemaVersion: 1, entries: [{
    competition: { name: "测试赛事", aliases: ["测试杯"], catalogNumber: 25, catalogYear: 2024, officialUrl: "https://example.edu/contest" },
    event: { editionLabel: "2026第1届", yearStart: 2026, yearEnd: 2026, trackName: "软件赛", stage: "通用规则" },
    sources: [{ key: "rules", url: "https://example.edu/contest/rules", textSha256: createHash("sha256").update(text).digest("hex") }],
    fields: [{ path: "team.studentMax", field: { kind: "integer", value: 3, state: "confirmed", note: "" }, evidence: [{ sourceKey: "rules", anchor: "同校学生最多3人。" }] },
      { path: "team.teacherMax", field: { kind: "integer", value: null, state: "unknown", note: "未取得规则" }, evidence: [] }],
  }] };
}

test("重复录入、人工编辑和已发布版本均跳过且不覆盖", () => {
  const f = competitionFixture();
  try {
    assert.deepEqual(seedCompetitionRules(f.store, manifest()), { created: 1, skipped: 0, failed: [] });
    const event = f.store.competitions.list()[0].event;
    const draft = f.store.competitions.getDetail(event.id).draft!;
    assert.equal(draft.body.fields["team.studentMax"]?.state, "unreviewed");
    assert.equal(draft.body.fields["team.teacherMax"]?.state, "unknown");
    assert.equal(draft.body.sources[0].confirmed, false);
    assert.equal(f.store.competitions.getDetail(event.id).current, null);
    assert.equal(seedCompetitionRules(f.store, manifest()).skipped, 1);
    const body = structuredClone(draft.body);
    body.fields["team.studentMax"]!.note = "人工编辑保留";
    body.fields["team.studentMax"]!.state = "confirmed";
    body.sources[0] = { ...body.sources[0], confirmed: true, applicabilityNote: "适用于2026软件赛通用规则" };
    const saved = f.store.competitions.saveDraft(draft.id, { expectedRevision: draft.editRevision, body, evidence: draft.evidence });
    assert.equal(seedCompetitionRules(f.store, manifest()).skipped, 1);
    assert.equal(f.store.competitions.getDetail(event.id).draft?.body.fields["team.studentMax"]?.note, "人工编辑保留");
    const published = f.store.competitions.publish(saved.id, saved.editRevision);
    assert.equal(seedCompetitionRules(f.store, manifest()).skipped, 1);
    assert.equal(f.store.competitions.getDetail(event.id).draft, null);
    f.store.deleteDocument(f.document.id);
    assert.equal(seedCompetitionRules(f.store, manifest()).skipped, 1);
    assert.equal(f.store.competitions.getDetail(event.id).draft, null);
    assert.equal(f.store.competitions.getDetail(event.id).versions.length, 1);
    assert.equal(published.status, "published");
  } finally { f.cleanup(); }
});

test("同URL不同正文只选择正确哈希，零匹配、多匹配与重复锚点不留下建档", () => {
  for (const mode of ["changed", "ambiguous", "anchor", "missingAnchor"] as const) {
    const f = competitionFixture();
    try {
      const text = mode === "anchor" ? "同校学生最多3人。同校学生最多3人。" : "同校学生最多3人。";
      const input = manifest(text);
      if (mode === "changed") input.entries[0].sources[0].textSha256 = "0".repeat(64);
      if (mode === "ambiguous" || mode === "anchor") f.store.importDocument({ title: "另一原文", competition: "测试赛事", sourceUrl: f.document.sourceUrl,
        kind: "rule", year: "2026", stage: "另一个阶段", fileName: "other.txt", pages: [{ page: null, text }] });
      if (mode === "missingAnchor") input.entries[0].fields[0].evidence[0].anchor = "不存在的要求";
      const report = seedCompetitionRules(f.store, input);
      assert.equal(report.failed.length, 1, mode);
      assert.equal(report.created, 0);
      assert.equal(f.store.competitions.listCompetitions().length, 0);
      assert.equal(f.store.competitions.list().length, 0);
    } finally { f.cleanup(); }
  }
  const f = competitionFixture();
  try {
    f.store.importDocument({ title: "旧规则", competition: "测试赛事", sourceUrl: f.document.sourceUrl, kind: "rule", year: "2025", stage: "通用规则", fileName: "old.txt", pages: [{ page: null, text: "同校学生最多4人。" }] });
    assert.equal(seedCompetitionRules(f.store, manifest()).created, 1);
    assert.equal(f.store.competitions.list()[0].draft?.evidence[0].documentId, f.document.id);
  } finally { f.cleanup(); }
});

test("跨分块锚点关联覆盖全文区间的全部片段，大小写和空白参与哈希", () => {
  assert.deepEqual(findAnchorChunks([{ id: "a", text: "先同校" }, { id: "b", text: "学生最多" }, { id: "c", text: "3人。后" }], "同校学生最多3人。"), ["a", "b", "c"]);
  assert.throws(() => findAnchorChunks([{ id: "a", text: "aaa" }], "aa"), /锚点/);
  const f = competitionFixture();
  try {
    const text = "A ".repeat(548) + "同校学生最多3人。\n";
    const doc = f.store.importDocument({ title: "跨分块规则", competition: "测试赛事", sourceUrl: f.document.sourceUrl, kind: "rule", year: "2026", stage: "通用规则", fileName: "long.txt", pages: [{ page: null, text }] }).document;
    assert.equal(seedCompetitionRules(f.store, manifest(text)).created, 1);
    const draft = f.store.competitions.list()[0].draft!;
    assert.equal(draft.evidence.length, 2);
    assert.ok(draft.evidence.every(entry => entry.documentId === doc.id));
  } finally { f.cleanup(); }
});

test("写入异常回滚整个赛道且其他条目仍成功", () => {
  const f = competitionFixture();
  try {
    const input = manifest();
    const second = structuredClone(input.entries[0]); second.competition.name = "另一个赛事";
    input.entries.push(second);
    const save = f.store.competitions.saveDraft.bind(f.store.competitions);
    let calls = 0;
    f.store.competitions.saveDraft = (...args) => { const result = save(...args); if (++calls === 1) throw new Error("模拟保存后失败"); return result; };
    const report = seedCompetitionRules(f.store, input);
    assert.equal(report.created, 1); assert.equal(report.failed.length, 1);
    assert.deepEqual(f.store.competitions.listCompetitions().map(c => c.name), ["另一个赛事"]);
    assert.equal(f.store.competitions.list()[0].draft?.version, 1);
  } finally { f.cleanup(); }
});

test("复用无版本建档且预检后续来源失败时不写入", () => {
  const f = competitionFixture();
  try {
    const eventId = f.createEvent();
    const input = manifest();
    input.entries[0].sources.push({ key: "missing", url: "https://example.edu/missing", textSha256: "0".repeat(64) });
    assert.equal(seedCompetitionRules(f.store, input).failed.length, 1);
    assert.equal(f.store.competitions.getDetail(eventId).versions.length, 0);
    assert.equal(seedCompetitionRules(f.store, manifest()).created, 1);
    assert.equal(f.store.competitions.list().length, 1);
    assert.equal(f.store.competitions.list()[0].event.id, eventId);
  } finally { f.cleanup(); }
});

test("命令行部分成功和全部缺资料返回结构化报告及退出码1", () => {
  const f = competitionFixture();
  try {
    const input = manifest();
    const missing = structuredClone(input.entries[0]);
    missing.competition.name = "缺少资料赛事";
    missing.sources[0].url = "https://example.edu/missing";
    input.entries.push(missing);
    const file = path.join(f.root, "manifest.json");
    writeFileSync(file, "\uFEFF" + JSON.stringify(input), "utf8");
    const run = () => spawnSync(process.execPath, ["--import", "tsx", "scripts/import-competition-rules.ts", file], {
      cwd: process.cwd(), env: { ...process.env, RAG_DATA_DIR: f.root }, encoding: "utf8", timeout: 20000,
    });
    const first = run();
    assert.equal(first.error, undefined);
    assert.equal(first.status, 1, first.stderr);
    const report = JSON.parse(first.stdout);
    assert.equal(report.created, 1); assert.equal(report.failed.length, 1);
    assert.equal(f.store.competitions.list()[0].draft?.status, "draft");
    const second = run();
    assert.equal(second.status, 1, second.stderr);
    assert.equal(JSON.parse(second.stdout).skipped, 1);
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, entries: [missing] }), "utf8");
    const absent = run();
    assert.equal(absent.status, 1, absent.stderr);
    assert.equal(JSON.parse(absent.stdout).created, 0);
    assert.equal(JSON.parse(absent.stdout).failed.length, 1);
  } finally { f.cleanup(); }
});

test("清单严格拒绝额外键、重复键/字段、未知来源、非法字段和日期", () => {
  assert.doesNotThrow(() => validateSeedManifest(manifest()));
  const mutations: Array<(v: any) => void> = [
    v => v.extra = true, v => v.entries[0].extra = true, v => v.entries[0].event.competitionId = "id",
    v => v.entries[0].sources[0].confirmed = true, v => v.entries[0].fields[0].extra = true,
    v => v.entries[0].fields[0].field.extra = true, v => v.entries[0].fields[0].evidence[0].extra = true,
    v => v.entries[0].sources.push(v.entries[0].sources[0]), v => v.entries[0].fields.push(v.entries[0].fields[0]),
    v => v.entries[0].fields[0].evidence[0].sourceKey = "unknown", v => v.entries[0].sources[0].url = "file:///tmp/a",
    v => v.entries[0].sources[0].textSha256 = "wrong", v => v.entries[0].fields[0].field.value = -1,
    v => v.entries[0].fields[0].path = "team.fake", v => v.entries[0].fields[0].evidence[0].anchor = "",
    v => v.entries[0].fields[0] = { path: "deadlines.bad", field: { kind: "date", state: "confirmed", note: "", value: { itemId: "bad", name: "截止", stage: "", precision: "date", value: "2026-02-30", timezone: "Asia/Shanghai" } }, evidence: [] },
  ];
  for (const mutate of mutations) { const input = structuredClone(manifest()); mutate(input); assert.throws(() => validateSeedManifest(input)); }
});
