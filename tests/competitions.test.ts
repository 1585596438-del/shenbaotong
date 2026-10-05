import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "node:path";
import { competitionFixture } from "./helpers/competition-fixture";
import { CompetitionError, FIELD_DEFINITIONS, emptyRuleBody, type FieldPath, type RuleBody, type RuleField } from "../src/server/competitions/types";
import { collectPublicationIssues, collectSourceIssues, validateBody, validateCalendar, validateCreateCompetition, validateCreateEvent, validateEvidenceInputs, validateSaveDraft } from "../src/server/competitions/validation";

const field = (kind: RuleField["kind"], value: RuleField["value"], state: RuleField["state"] = "confirmed", note = ""): RuleField => ({ kind, value, state, note });
const body = (fields: RuleBody["fields"] = {}): RuleBody => ({ schemaVersion: 1, sources: [{ documentId: "doc-1", applicabilityNote: "适用于2026全国赛", confirmed: true }], fields });
const competition = () => ({ name: "测试赛", aliases: ["别名"], catalogNumber: null, catalogYear: null, officialUrl: "" });
const event = () => ({ competitionId: "competition-1", editionLabel: "第十届", yearStart: 2026, yearEnd: 2026, trackName: "通用", stage: "全国赛" });
const evidence = (fieldPath: FieldPath = "content.summary", documentId = "doc-1", chunkId = "chunk-1") => ({ fieldPath, documentId, chunkId });
const rejects = (fn: () => unknown) => assert.throws(fn, (error: unknown) => error instanceof CompetitionError && error.status === 400);
const statusRejects = (status: number, fn: () => unknown) => assert.throws(fn, (error: unknown) => error instanceof CompetitionError && error.status === status);

test("draft permits missing proof, revisions conflict, and only real paired proof permits publication", () => {
  const f = competitionFixture();
  try {
    const store = f.store.competitions;
    const eventId = f.createEvent();
    const draft = store.ensureDraft(eventId);
    assert.deepEqual(store.ensureDraft(eventId), draft);
    const ruleBody: RuleBody = { ...body({ "team.studentMax": field("integer", 3) }), sources: [{ documentId: f.document.id, applicabilityNote: "2026软件赛通用规则", confirmed: true }] };
    const saved = store.saveDraft(draft.id, { expectedRevision: draft.editRevision, body: ruleBody, evidence: [] });
    assert.equal(saved.editRevision, draft.editRevision + 1);
    assert.deepEqual(store.getDetail(eventId).event.sourceDocumentIds, []);
    rejects(() => store.publish(saved.id, saved.editRevision));
    statusRejects(409, () => store.saveDraft(saved.id, { expectedRevision: draft.editRevision, body: ruleBody, evidence: [] }));
    statusRejects(409, () => store.publish(saved.id, draft.editRevision));
    const other = f.store.importDocument({ title: "2026测试赛事补充规则", competition: "测试赛事", kind: "rule", year: "2026", stage: "通用规则", sourceUrl: "", fileName: "other.txt", pages: [{ page: null, text: "另一文档" }] }).document;
    const otherChunk = f.store.getChunks([other.id])[0];
    rejects(() => store.saveDraft(saved.id, { expectedRevision: saved.editRevision, body: ruleBody, evidence: [evidence("team.studentMax", f.document.id, otherChunk.id)] }));
    assert.deepEqual(store.getVersion(saved.id), saved);
    const proven = store.saveDraft(saved.id, { expectedRevision: saved.editRevision, body: ruleBody, evidence: [evidence("team.studentMax", f.document.id, f.chunk.id)] });
    const published = store.publish(proven.id, proven.editRevision);
    assert.equal(published.status, "published");
    assert.equal(published.editRevision, proven.editRevision + 1);
    assert.ok(published.publishedAt && Number.isFinite(Date.parse(published.publishedAt)));
    assert.deepEqual(store.getDetail(eventId).event.sourceDocumentIds, [f.document.id]);
    statusRejects(409, () => store.publish(published.id, published.editRevision));
    statusRejects(409, () => store.saveDraft(published.id, { expectedRevision: published.editRevision, body: ruleBody, evidence: [] }));
  } finally { f.cleanup(); }
});

test("new draft clones published evidence without changing history and atomic publication replaces v1", () => {
  const f = competitionFixture();
  let db: Database.Database | undefined;
  try {
    const v1 = f.publishStudentLimit();
    const store = f.store.competitions;
    const v2 = store.ensureDraft(v1.eventId);
    assert.equal(v2.version, 2);
    assert.deepEqual(v2.body, v1.body);
    assert.deepEqual(v2.evidence, v1.evidence);
    assert.equal(store.ensureDraft(v1.eventId).id, v2.id);
    v2.body.fields["team.studentMax"]!.value = 4;
    const saved = store.saveDraft(v2.id, { expectedRevision: v2.editRevision, body: v2.body, evidence: v2.evidence });
    assert.deepEqual(store.getVersion(v1.id), v1);
    // Force failure after archiving to prove all publication mutations share one transaction.
    db = new Database(path.join(f.root, "knowledge.sqlite"));
    db.exec("CREATE TRIGGER reject_publish BEFORE UPDATE OF status ON competition_rule_versions WHEN NEW.version=2 AND NEW.status='published' BEGIN SELECT RAISE(ABORT, 'test publication failure'); END");
    assert.throws(() => store.publish(saved.id, saved.editRevision));
    assert.deepEqual(store.getVersion(v1.id), v1);
    assert.deepEqual(store.getVersion(saved.id), saved);
    db.exec("DROP TRIGGER reject_publish");
    const published = store.publish(saved.id, saved.editRevision);
    assert.equal(published.status, "published");
    assert.equal(store.getVersion(v1.id).status, "archived");
    assert.deepEqual(store.getVersion(v1.id).body, v1.body);
    assert.equal(store.getDetail(v1.eventId).versions.filter(v => v.status === "published").length, 1);
    f.reopen();
    assert.equal(f.store.competitions.getDetail(v1.eventId).current?.id, published.id);
  } finally { db?.close(); f.cleanup(); }
});

test("draft cloning removes stale proof and resets needs-review ancestry", () => {
  const f = competitionFixture();
  let db: Database.Database | undefined;
  try {
    const v1 = f.publishStudentLimit();
    f.store.deleteDocument(f.document.id);
    const draft = f.store.competitions.ensureDraft(v1.eventId);
    assert.deepEqual(draft.body.sources, []);
    assert.deepEqual(draft.evidence, []);
    assert.equal(draft.body.fields["team.studentMax"]?.state, "unreviewed");
    assert.equal(f.store.competitions.getVersion(v1.id).body.fields["team.studentMax"]?.state, "confirmed");
    db = new Database(path.join(f.root, "knowledge.sqlite"));
    db.prepare("UPDATE competition_rule_versions SET status='needs_review' WHERE id=?").run(draft.id);
    const clone = f.store.competitions.ensureDraft(v1.eventId);
    assert.equal(clone.version, 3);
    assert.equal(clone.body.fields["team.studentMax"]?.state, "unreviewed");
    assert.deepEqual(clone.body.sources, []);
  } finally { db?.close(); f.cleanup(); }
});

test("missing versions, invalid revisions and stale selected documents fail without mutating draft", () => {
  const f = competitionFixture();
  try {
    const store = f.store.competitions;
    statusRejects(404, () => store.ensureDraft("missing"));
    statusRejects(404, () => store.saveDraft("missing", { expectedRevision: 0, body: emptyRuleBody(), evidence: [] }));
    statusRejects(404, () => store.publish("missing", 0));
    const draft = store.ensureDraft(f.createEvent());
    for (const revision of [-1, 1.5, NaN, Infinity, "0"]) rejects(() => store.publish(draft.id, revision as number));
    rejects(() => store.saveDraft(draft.id, { expectedRevision: 0, body: body(), evidence: [] }));
    const ruleBody = { ...body({ "team.studentMax": field("integer", 3) }), sources: [{ documentId: f.document.id, applicabilityNote: "适用", confirmed: false }] };
    rejects(() => store.saveDraft(draft.id, { expectedRevision: 0, body: ruleBody, evidence: [evidence("team.studentMax", f.document.id, "missing")] }));
    const saved = store.saveDraft(draft.id, { expectedRevision: 0, body: ruleBody, evidence: [evidence("team.studentMax", f.document.id, f.chunk.id)] });
    f.store.deleteDocument(f.document.id);
    rejects(() => store.publish(saved.id, saved.editRevision));
    assert.equal(store.getVersion(saved.id).status, "draft");
  } finally { f.cleanup(); }
});

test("publication checks selected source year, competition, track, stage and school-only kinds", () => {
  const cases = [
    { title: "2025测试赛事规则", year: "2025", accepted: false },
    { title: "2025测试赛事规则", year: "2026", accepted: false },
    { title: "2025-2026测试赛事规则", year: "2025-2026", accepted: true },
    { title: "测试赛事规则", year: "", accepted: true },
    { title: "2026其他比赛规则", competition: "其他比赛", accepted: false },
    { title: "2026测试杯规则", competition: "测试杯", accepted: true },
    { title: "2026测试赛事硬件赛规则", accepted: false },
    { title: "2026测试赛事软件赛、硬件赛时间通知", kind: "notice", accepted: true },
    { title: "2026测试赛事省赛规则", stage: "省赛", eventStage: "全国赛", accepted: false },
    { title: "2026测试赛事校赛、省赛、国赛通用规则", stage: "校赛、省赛、国赛通用要求", eventStage: "全国赛", accepted: true },
    { title: "2026测试赛事目录", kind: "catalog", accepted: false },
    { title: "2026测试赛事管理政策", kind: "policy", accepted: false },
  ];
  for (const scenario of cases) {
    const f = competitionFixture();
    try {
      const store = f.store.competitions;
      let eventId = f.createEvent();
      if (scenario.eventStage) {
        const original = store.getDetail(eventId).event;
        eventId = store.createEvent({ competitionId: original.competitionId, editionLabel: original.editionLabel, yearStart: original.yearStart, yearEnd: original.yearEnd, trackName: original.trackName, stage: scenario.eventStage }).id;
      }
      const source = f.store.importDocument({ title: scenario.title, competition: scenario.competition ?? "测试赛事", year: scenario.year ?? "2026", stage: scenario.stage ?? "通用规则", kind: (scenario.kind ?? "rule") as "rule" | "notice" | "catalog" | "policy", sourceUrl: "", fileName: "scope.txt", pages: [{ page: null, text: scenario.title }] }).document;
      const draft = store.ensureDraft(eventId);
      const saved = store.saveDraft(draft.id, { expectedRevision: draft.editRevision, body: { schemaVersion: 1, sources: [{ documentId: source.id, confirmed: true, applicabilityNote: "人工确认适用于2026软件赛当前阶段；不能覆盖明确不相符的原文" }], fields: { "team.studentMax": field("integer", 3) } }, evidence: [evidence("team.studentMax", source.id, f.store.getChunks([source.id])[0].id)] });
      if (scenario.accepted) assert.equal(store.publish(saved.id, saved.editRevision).status, "published", scenario.title);
      else rejects(() => store.publish(saved.id, saved.editRevision));
    } finally { f.cleanup(); }
  }
});

test("historical catalog can be selected for school background but never confirms current-year category", () => {
  const f = competitionFixture();
  try {
    const catalog = f.store.importDocument({ title: "2024学校竞赛认定目录", competition: "学校目录", kind: "catalog", year: "2024", stage: "学校认定", sourceUrl: "", fileName: "catalog.txt", pages: [{ page: null, text: "2024测试学校认定B类" }] }).document;
    const draft = f.store.competitions.ensureDraft(f.createEvent());
    const ruleBody: RuleBody = { schemaVersion: 1, sources: [{ documentId: f.document.id, confirmed: true, applicabilityNote: "2026软件赛通用规则" }, { documentId: catalog.id, confirmed: true, applicabilityNote: "仅用于2024学校历史认定背景，不作2026认定" }], fields: { "team.studentMax": field("integer", 3), "school.name": field("text", "测试学校"), "school.basisYear": field("integer", 2024), "school.category": field("text", "B类") } };
    const proof = [evidence("team.studentMax", f.document.id, f.chunk.id), ...(["school.name", "school.basisYear", "school.category"] as const).map(p => evidence(p, catalog.id, f.store.getChunks([catalog.id])[0].id))];
    const saved = f.store.competitions.saveDraft(draft.id, { expectedRevision: 0, body: ruleBody, evidence: proof });
    rejects(() => f.store.competitions.publish(saved.id, saved.editRevision));
    ruleBody.fields["school.basisYear"]!.value = 2026;
    const wrongYear = f.store.competitions.saveDraft(saved.id, { expectedRevision: saved.editRevision, body: ruleBody, evidence: proof });
    rejects(() => f.store.competitions.publish(wrongYear.id, wrongYear.editRevision));
    ruleBody.fields["school.category"] = field("text", null, "unknown");
    ruleBody.fields["school.basisYear"]!.value = 2024;
    const background = f.store.competitions.saveDraft(saved.id, { expectedRevision: wrongYear.editRevision, body: ruleBody, evidence: proof.filter(e => e.fieldPath !== "school.category") });
    assert.equal(f.store.competitions.publish(background.id, background.editRevision).status, "published");
  } finally { f.cleanup(); }
});

test("current school category clones valid proof and latest needs-review resets every valued field and source", () => {
  const f = competitionFixture();
  let db: Database.Database | undefined;
  try {
    const catalog = f.store.importDocument({ title: "2026学校竞赛认定目录", competition: "学校目录", kind: "catalog", year: "2026", stage: "学校认定", sourceUrl: "", fileName: "catalog.txt", pages: [{ page: null, text: "2026测试学校认定B类" }] }).document;
    const draft = f.store.competitions.ensureDraft(f.createEvent());
    const ruleBody: RuleBody = { schemaVersion: 1, sources: [{ documentId: f.document.id, confirmed: true, applicabilityNote: "2026软件赛通用规则" }, { documentId: catalog.id, confirmed: true, applicabilityNote: "2026学校认定" }], fields: { "team.studentMax": field("integer", 3), "team.teacherMin": field("integer", 0), "student.fullTimeRequired": field("boolean", false), "school.name": field("text", "测试学校"), "school.basisYear": field("integer", 2026), "school.category": field("text", "B类"), "tags.skills": field("texts", ["编程"], "confirmed", "人工建议"), "team.teacherMax": field("integer", null, "unknown") } };
    const proof = [...(["team.studentMax", "team.teacherMin", "student.fullTimeRequired"] as const).map(p => evidence(p, f.document.id, f.chunk.id)), ...(["school.name", "school.basisYear", "school.category"] as const).map(p => evidence(p, catalog.id, f.store.getChunks([catalog.id])[0].id))];
    const saved = f.store.competitions.saveDraft(draft.id, { expectedRevision: 0, body: ruleBody, evidence: proof });
    const published = f.store.competitions.publish(saved.id, saved.editRevision);
    const clone = f.store.competitions.ensureDraft(published.eventId);
    assert.deepEqual(clone.body, published.body);
    assert.deepEqual(clone.evidence, published.evidence);
    db = new Database(path.join(f.root, "knowledge.sqlite"));
    db.prepare("UPDATE competition_rule_versions SET status='needs_review' WHERE id=?").run(clone.id);
    const review = f.store.competitions.ensureDraft(published.eventId);
    assert.equal(review.version, 3);
    assert.equal(review.body.fields["team.teacherMin"]?.value, 0);
    assert.equal(review.body.fields["student.fullTimeRequired"]?.value, false);
    for (const entry of Object.values(review.body.fields)) if (entry?.value !== null) assert.equal(entry?.state, "unreviewed");
    assert.equal(review.body.fields["team.teacherMax"]?.state, "unknown");
    assert.ok(review.body.sources.every(source => !source.confirmed));
    assert.deepEqual(review.evidence, published.evidence);
    assert.deepEqual(f.store.competitions.getVersion(published.id), published);
  } finally { db?.close(); f.cleanup(); }
});

test("shared A/B registration sources apply to either group and a clear different group does not", () => {
  const f = competitionFixture();
  try {
    const original = f.store.competitions.getDetail(f.createEvent());
    const detail = { competition: original.competition, event: { ...original.event, trackName: "A组" } };
    const source = { ...f.document, title: "2026测试赛事A/B组报名规则" };
    const ruleBody: RuleBody = { ...body(), sources: [{ documentId: source.id, confirmed: true, applicabilityNote: "适用于2026 A组报名" }] };
    assert.deepEqual(collectSourceIssues(detail, ruleBody, [], new Map([[source.id, source]])), []);
    const other = { ...source, title: "2026测试赛事B组规则" };
    assert.ok(collectSourceIssues(detail, ruleBody, [], new Map([[other.id, other]])).some(issue => issue.fieldPath === "sources"));
  } finally { f.cleanup(); }
});

test("specific software subjects cannot provide Python rules but generic and all-subject notices apply", () => {
  const f = competitionFixture();
  try {
    const original = f.store.competitions.getDetail(f.createEvent());
    const detail = { competition: original.competition, event: { ...original.event, trackName: "软件赛Python" } };
    const ruleBody: RuleBody = { ...body(), sources: [{ documentId: f.document.id, confirmed: true, applicabilityNote: "人工确认2026软件赛Python" }] };
    for (const subject of ["C/C++", "C / C ++", "C++", "C", "Web", "网络安全", "软件测试", "Java"]) {
      const source = { ...f.document, title: `2026测试赛事软件赛${subject}规则` };
      assert.ok(collectSourceIssues(detail, ruleBody, [], new Map([[source.id, source]])).some(issue => issue.fieldPath === "sources"), subject);
      const metadataOnly = { ...source, title: "2026测试赛事规则", competition: `测试赛事／软件赛${subject}` };
      assert.ok(collectSourceIssues(detail, ruleBody, [], new Map([[source.id, metadataOnly]])).some(issue => issue.fieldPath === "sources"), `${subject} competition metadata`);
    }
    for (const title of ["2026测试赛事软件赛规则", "2026测试赛事软件赛全部科目时间通知", "2026测试赛事软件赛所有科目规则", "2026测试赛事软件赛C/C++、Python、Java、Web时间通知", "2026测试赛事软件赛 Python 规则"]) {
      const source = { ...f.document, title };
      assert.deepEqual(collectSourceIssues(detail, ruleBody, [], new Map([[source.id, source]])), [], title);
    }
    for (const variant of ["C/C++", "C / C ++", "C++", "C"]) {
      const source = { ...f.document, title: `2026测试赛事软件赛${variant}规则` };
      const cDetail = { ...detail, event: { ...detail.event, trackName: "软件赛C/C++" } };
      assert.deepEqual(collectSourceIssues(cDetail, ruleBody, [], new Map([[source.id, source]])), [], variant);
    }
  } finally { f.cleanup(); }
});

test("national final stage names are equivalent while provincial and initial stages remain distinct", () => {
  const f = competitionFixture();
  try {
    const original = f.store.competitions.getDetail(f.createEvent());
    const ruleBody: RuleBody = { ...body(), sources: [{ documentId: f.document.id, confirmed: true, applicabilityNote: "人工确认国赛阶段" }] };
    for (const eventStage of ["总决赛", "全国总决赛", "国赛", "全国赛"]) {
      const detail = { competition: original.competition, event: { ...original.event, stage: eventStage } };
      for (const sourceStage of ["总决赛", "全国总决赛", "国赛", "全国赛"]) {
        const source = { ...f.document, title: `2026测试赛事${sourceStage}规则`, stage: sourceStage };
        assert.deepEqual(collectSourceIssues(detail, ruleBody, [], new Map([[source.id, source]])), [], `${sourceStage} -> ${eventStage}`);
      }
      for (const sourceStage of ["省赛", "初赛"]) {
        const source = { ...f.document, title: `2026测试赛事${sourceStage}规则`, stage: sourceStage };
        assert.ok(collectSourceIssues(detail, ruleBody, [], new Map([[source.id, source]])).some(issue => issue.fieldPath === "sources"));
      }
    }
  } finally { f.cleanup(); }
});

test("SQLite rule initialization preserves sources and persists competition events after reopening", () => {
  const f = competitionFixture();
  try {
    const competition = f.store.competitions.createCompetition({ name: "测试赛事", aliases: ["测试杯"], catalogNumber: 25, catalogYear: 2024, officialUrl: "https://example.edu/contest" });
    const event = f.store.competitions.createEvent({ competitionId: competition.id, editionLabel: "2026第1届", yearStart: 2026, yearEnd: 2026, trackName: "软件赛", stage: "通用规则" });
    f.reopen();
    f.reopen();
    assert.equal(f.store.listDocuments().length, 1);
    assert.equal(f.store.getDocument(f.document.id)?.chunks[0].text, "同校学生最多3人。");
    const detail = f.store.competitions.getDetail(event.id);
    assert.deepEqual(detail.competition, competition);
    assert.deepEqual(detail.event, event);
    assert.deepEqual(detail.versions, []);
    assert.equal(detail.current, null);
    assert.equal(detail.draft, null);
    assert.deepEqual(event.sourceDocumentIds, []);
    assert.deepEqual(f.store.competitions.list(), [{ competition, event, current: null, draft: null }]);
  } finally { f.cleanup(); }
});

test("competition and edition uniqueness return conflicts without creating partial records", () => {
  const f = competitionFixture();
  try {
    const eventId = f.createEvent();
    assert.equal(f.createEvent(), eventId);
    const detail = f.store.competitions.getDetail(eventId);
    const conflict = (fn: () => unknown) => assert.throws(fn, (error: unknown) => error instanceof CompetitionError && error.status === 409 && /已存在/.test(error.message));
    conflict(() => f.store.competitions.createCompetition({ name: "测试赛事", aliases: [], catalogNumber: null, catalogYear: null, officialUrl: "" }));
    const input = { competitionId: detail.competition.id, editionLabel: "2026第1届", yearStart: 2026, yearEnd: 2026, trackName: "软件赛", stage: "通用规则" };
    conflict(() => f.store.competitions.createEvent(input));
    f.store.competitions.createEvent({ ...input, stage: "全国赛" });
    f.store.competitions.createEvent({ ...input, trackName: "硬件赛" });
    assert.equal(f.store.competitions.list().length, 3);
  } finally { f.cleanup(); }
});

test("competition metadata lists parents even when no editions have been created", () => {
  const f = competitionFixture();
  try {
    assert.deepEqual(f.store.competitions.listCompetitions(), []);
    const parent = f.store.competitions.createCompetition(competition());
    assert.deepEqual(f.store.competitions.listCompetitions(), [parent]);
    assert.deepEqual(f.store.competitions.list(), []);
    f.reopen();
    assert.deepEqual(f.store.competitions.listCompetitions(), [parent]);
  } finally { f.cleanup(); }
});

test("store rejects invalid creation payloads and reports missing competition, event and version", () => {
  const f = competitionFixture();
  try {
    assert.deepEqual(f.store.competitions.list(), []);
    const missing = (fn: () => unknown) => assert.throws(fn, (error: unknown) => error instanceof CompetitionError && error.status === 404);
    missing(() => f.store.competitions.createEvent(event()));
    missing(() => f.store.competitions.getDetail("missing-event"));
    missing(() => f.store.competitions.getVersion("missing-version"));
    rejects(() => f.store.competitions.createCompetition({ ...competition(), name: " " }));
    rejects(() => f.store.competitions.createEvent({ ...event(), sourceDocumentIds: [f.document.id] } as never));
    assert.deepEqual(f.store.competitions.list(), []);
    assert.deepEqual(f.store.competitions.getDetail(f.createEvent()).event.sourceDocumentIds, []);
  } finally { f.cleanup(); }
});

test("queries deserialize version bodies and plain evidence, selecting only published and draft statuses", () => {
  const f = competitionFixture();
  let db: Database.Database | undefined;
  try {
    const eventId = f.createEvent();
    db = new Database(path.join(f.root, "knowledge.sqlite"));
    db.pragma("foreign_keys = ON");
    const ruleBody = { ...body({ "team.studentMax": field("integer", 3) }), sources: [{ documentId: f.document.id, applicabilityNote: "2026通用规则", confirmed: true }] };
    const createdAt = "2026-10-05T00:00:00.000Z";
    const insert = db.prepare("INSERT INTO competition_rule_versions (id,eventId,version,status,bodyJson,editRevision,createdAt,updatedAt,publishedAt) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const [version, status] of [[1, "archived"], [2, "published"], [3, "needs_review"], [4, "draft"]] as const) {
      insert.run(`version-${version}`, eventId, version, status, JSON.stringify(ruleBody), 7, createdAt, createdAt, status === "published" ? createdAt : null);
    }
    db.prepare("INSERT INTO competition_rule_evidence (id,versionId,fieldPath,documentId,chunkId) VALUES (?,?,?,?,?)").run("evidence-1", "version-2", "team.studentMax", f.document.id, f.chunk.id);
    db.close(); db = undefined;
    f.reopen();
    const current = f.store.competitions.getVersion("version-2");
    assert.deepEqual(current, { id: "version-2", eventId, version: 2, status: "published", body: ruleBody, evidence: [{ fieldPath: "team.studentMax", documentId: f.document.id, chunkId: f.chunk.id }], editRevision: 7, createdAt, updatedAt: createdAt, publishedAt: createdAt });
    const detail = f.store.competitions.getDetail(eventId);
    assert.deepEqual(detail.versions.map(version => version.version), [4, 3, 2, 1]);
    assert.deepEqual(detail.current, current);
    assert.equal(detail.draft?.id, "version-4");
    assert.deepEqual(f.store.competitions.list(), [{ competition: detail.competition, event: detail.event, current, draft: detail.draft }]);
    const detached = f.store.competitions.getDetail(eventId);
    detached.competition.aliases.push("changed");
    detached.current!.body.fields["team.studentMax"]!.value = 99;
    assert.deepEqual(f.store.competitions.getDetail(eventId).competition.aliases, ["测试杯"]);
    assert.equal(f.store.competitions.getVersion("version-2").body.fields["team.studentMax"]?.value, 3);
    db = new Database(path.join(f.root, "knowledge.sqlite"));
    db.prepare("UPDATE competition_rule_versions SET status='archived' WHERE id='version-2'").run();
    db.prepare("UPDATE competition_rule_versions SET status='needs_review' WHERE id='version-4'").run();
    assert.equal(f.store.competitions.getDetail(eventId).current, null);
    assert.equal(f.store.competitions.getDetail(eventId).draft, null);
    assert.equal(f.store.competitions.list()[0].current, null);
    assert.equal(f.store.competitions.list()[0].draft, null);
  } finally { db?.close(); f.cleanup(); }
});

test("incremental schema enforces version uniqueness, statuses and evidence foreign keys", () => {
  const f = competitionFixture();
  let db: Database.Database | undefined;
  try {
    const eventId = f.createEvent();
    f.reopen();
    db = new Database(path.join(f.root, "knowledge.sqlite"));
    db.pragma("foreign_keys = ON");
    const insert = db.prepare("INSERT INTO competition_rule_versions (id,eventId,version,status,bodyJson,editRevision,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)");
    const add = (id: string, version: number, status: string, parent = eventId) => insert.run(id, parent, version, status, JSON.stringify(emptyRuleBody()), 0, "now", "now");
    add("draft-1", 1, "draft");
    assert.throws(() => add("draft-2", 2, "draft"), /UNIQUE/);
    add("published-1", 2, "published");
    assert.throws(() => add("published-2", 3, "published"), /UNIQUE/);
    assert.throws(() => add("same-version", 1, "archived"), /UNIQUE/);
    assert.throws(() => add("invalid-status", 3, "invalid"), /CHECK/);
    assert.throws(() => add("missing-event", 3, "archived", "missing"), /FOREIGN KEY/);
    const evidenceInsert = db.prepare("INSERT INTO competition_rule_evidence (id,versionId,fieldPath,documentId,chunkId) VALUES (?,?,?,?,?)");
    assert.throws(() => evidenceInsert.run("bad-doc", "draft-1", "team.studentMax", "missing", f.chunk.id), /FOREIGN KEY/);
    assert.throws(() => evidenceInsert.run("bad-chunk", "draft-1", "team.studentMax", f.document.id, "missing"), /FOREIGN KEY/);
    assert.throws(() => evidenceInsert.run("bad-version", "missing", "team.studentMax", f.document.id, f.chunk.id), /FOREIGN KEY/);
    evidenceInsert.run("good", "draft-1", "team.studentMax", f.document.id, f.chunk.id);
    assert.throws(() => evidenceInsert.run("duplicate", "draft-1", "team.studentMax", f.document.id, f.chunk.id), /UNIQUE/);
    db.prepare("DELETE FROM competition_rule_versions WHERE id=?").run("draft-1");
    assert.deepEqual(db.prepare("SELECT id FROM competition_rule_evidence").all(), []);
    evidenceInsert.run("source-deleted", "published-1", "team.studentMax", f.document.id, f.chunk.id);
    f.store.deleteDocument(f.document.id);
    assert.deepEqual(f.store.competitions.getVersion("published-1").evidence, []);
  } finally { db?.close(); f.cleanup(); }
});

test("omitted fields and unknown null preserve incomplete drafts, including false and zero", () => {
  assert.deepEqual(emptyRuleBody(), { schemaVersion: 1, sources: [], fields: {} });
  assert.deepEqual(validateBody(emptyRuleBody()), emptyRuleBody());
  const input = body({ "team.studentMin": field("integer", null, "unknown"), "team.teacherMin": field("integer", 0), "student.fullTimeRequired": field("boolean", false) });
  assert.deepEqual(validateBody(input), input);
  rejects(() => validateBody(body({ "team.studentMin": field("integer", 0, "unknown") })));
  for (const state of ["confirmed", "unreviewed", "conflict"] as const) rejects(() => validateBody(body({ "content.summary": field("text", null, state) })));
});

test("count relationships reject reversed bounds, accepting equality and endpoints", () => {
  rejects(() => validateBody(body({ "team.studentMin": field("integer", 4), "team.studentMax": field("integer", 3) })));
  rejects(() => validateBody(body({ "team.teacherMin": field("integer", 2), "team.teacherMax": field("integer", 1) })));
  assert.equal(validateBody(body({ "team.studentMin": field("integer", 0), "team.studentMax": field("integer", 1000) })).fields["team.studentMax"]?.value, 1000);
  validateBody(body({ "team.teacherMin": field("integer", 2), "team.teacherMax": field("integer", 2) }));
  for (const value of [-1, 1001, 1.2, NaN, Infinity, "3"]) rejects(() => validateBody(body({ "team.studentMin": { ...field("integer", 0), value } }) as unknown));
  validateBody(body({ "school.basisYear": field("integer", 2000) }));
  validateBody(body({ "school.basisYear": field("integer", 2100) }));
  for (const value of [1999, 2101]) rejects(() => validateBody(body({ "school.basisYear": field("integer", value) })));
});

test("calendar validates real dates and Shanghai timestamps without inferring times", () => {
  for (const value of ["2026-07-20", "2024-02-29", "2000-02-29"]) validateCalendar(value, "date");
  for (const value of ["2026-07-20T15:00:00+08:00", "2026-12-31T23:59:59+08:00"]) validateCalendar(value, "datetime");
  for (const value of ["2026-02-30", "2026-02-29", "2100-02-29", "2026-13-01", "2026-00-01", "2026-07-00", "2026-7-20", "2026-07-20\n", "2026-07-20T15:00:00+08:00"]) rejects(() => validateCalendar(value, "date"));
  for (const value of ["2026-07-20", "2026-02-30T15:00:00+08:00", "2026-07-20T24:00:00+08:00", "2026-07-20T15:60:00+08:00", "2026-07-20T15:00:60+08:00", "2026-07-20T15:00:00Z", "2026-07-20T15:00:00+09:00", "2026-07-20T15:00:00.000+08:00", "2026-07-20T15:00:00+08:00\n"]) rejects(() => validateCalendar(value, "datetime"));
});

test("fixed field kinds and nonempty text arrays are enforced with bounded text", () => {
  assert.equal(FIELD_DEFINITIONS.length, 22);
  rejects(() => validateBody(body({ "student.fullTimeRequired": field("text", "是") })));
  rejects(() => validateBody(body({ "content.summary": field("text", " ") })));
  rejects(() => validateBody(body({ "content.summary": field("text", "x".repeat(2001)) })));
  validateBody(body({ "content.summary": field("text", "不限", "confirmed", "x".repeat(2000)) }));
  rejects(() => validateBody(body({ "content.summary": field("text", "不限", "confirmed", "x".repeat(2001)) })));
  for (const value of [[], [""], [" "], ["x".repeat(81)], Array(31).fill("x"), [1], "x"]) rejects(() => validateBody(body({ "student.levels": { ...field("texts", ["本科"]), value } }) as unknown));
  validateBody(body({ "student.levels": field("texts", Array(30).fill("x".repeat(80))) }));
  rejects(() => validateBody(body({ "student.fullTimeRequired": { ...field("boolean", false), value: "false" } }) as unknown));
});

test("dynamic deadline and material items have strict stable paths and matching identifiers", () => {
  const deadline = { itemId: "submit-1", name: "作品提交", stage: "国赛", precision: "date", value: "2026-07-20", timezone: "Asia/Shanghai" };
  const material = { itemId: "video_1", name: "视频", stage: "国赛", requirement: "unknown", condition: "" };
  const input = body({ "deadlines.submit-1": field("date", deadline as never), "materials.video_1": field("material", material as never) });
  assert.deepEqual(validateBody(input), input);
  for (const changes of [{ itemId: "different" }, { timezone: "UTC" }, { precision: "date", value: "2026-07-20T15:00:00+08:00" }, { name: "" }, { extra: true }]) rejects(() => validateBody(body({ "deadlines.submit-1": field("date", { ...deadline, ...changes } as never) })));
  rejects(() => validateBody(body({ "materials.video_1": field("material", { ...material, requirement: "maybe" } as never) })));
  for (const path of ["deadlines.", "deadlines.中文", "deadlines.a.b", "materials.a/b", "deadlines.submit\n", `deadlines.${"a".repeat(71)}`]) rejects(() => validateBody({ ...body(), fields: { [path]: field("date", null, "unknown") } }));
  validateBody({ ...body(), fields: { [`deadlines.${"a".repeat(70)}`]: field("date", null, "unknown") } });
  rejects(() => validateBody(body({ "deadlines.submit-1": field("material", material as never) })));
});

test("invalid shapes, unknown keys and prototype properties are rejected without invoking getters", () => {
  for (const invalid of [null, [], "body", 1]) rejects(() => validateBody(invalid));
  for (const input of [{ ...body(), extra: true }, { ...body(), schemaVersion: 2 }, { ...body(), fields: { "team.bogus": field("integer", 2) } }, { ...body(), fields: { constructor: field("text", "x") } }, JSON.parse('{"schemaVersion":1,"sources":[],"fields":{"__proto__":{}}}'), { ...body(), fields: { "content.summary": { ...field("text", "x"), extra: 1 } } }, { ...body(), sources: [{ documentId: "doc-1", applicabilityNote: "x", confirmed: true, extra: 1 }] }]) rejects(() => validateBody(input));
  rejects(() => validateBody(Object.create(body())));
  let invoked = false;
  const accessor = { ...body() };
  Object.defineProperty(accessor, "fields", { enumerable: true, get() { invoked = true; return {}; } });
  rejects(() => validateBody(accessor));
  assert.equal(invoked, false);
});

test("body cardinality and UTF8 byte limits prevent oversized drafts", () => {
  rejects(() => validateBody({ ...body(), sources: Array.from({ length: 31 }, (_, i) => ({ documentId: `doc-${i}`, applicabilityNote: "x", confirmed: true })) }));
  rejects(() => validateBody({ ...body(), sources: [...body().sources, ...body().sources] }));
  rejects(() => validateBody({ ...body(), sources: [{ documentId: "", applicabilityNote: "x", confirmed: false }] }));
  rejects(() => validateBody({ ...body(), sources: [{ documentId: "doc-1", applicabilityNote: "x".repeat(501), confirmed: false }] }));
  for (const prefix of ["deadlines", "materials"]) {
    const fields = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`${prefix}.item-${i}`, field(prefix === "deadlines" ? "date" : "material", null, "unknown")]));
    rejects(() => validateBody({ ...body(), fields }));
  }
  const largeFields = Object.fromEntries(FIELD_DEFINITIONS.map(({ path, kind }) => [path, field(kind, null, "unknown", "汉".repeat(2000))]));
  rejects(() => validateBody({ ...body(), fields: largeFields }));
});

test("competition input validates catalog boundaries, URLs, names and returns detached data", () => {
  const input = { ...competition(), catalogNumber: 1, catalogYear: 2000, officialUrl: "https://example.edu/rules" };
  assert.deepEqual(validateCreateCompetition(input), input);
  validateCreateCompetition({ ...input, catalogYear: 2100, officialUrl: "http://example.edu/" });
  assert.equal(validateCreateCompetition({ ...competition(), officialUrl: "   " }).officialUrl, "");
  assert.equal(validateCreateCompetition({ ...competition(), officialUrl: "  https://EXAMPLE.edu  " }).officialUrl, "https://example.edu/");
  for (const changes of [{ name: " " }, { name: "x".repeat(161) }, { catalogNumber: 0 }, { catalogNumber: 1.2 }, { catalogYear: 1999 }, { catalogYear: 2101 }, { officialUrl: "ftp://example.edu" }, { officialUrl: "https://user:password@example.edu" }, { aliases: [""] }, { aliases: Array(31).fill("alias") }, { extra: 1 }]) rejects(() => validateCreateCompetition({ ...competition(), ...changes }));
  const parsed = validateCreateCompetition(input);
  input.aliases.push("later");
  assert.deepEqual(parsed.aliases, ["别名"]);
  for (const invalid of [null, [], {}]) rejects(() => validateCreateCompetition(invalid));
});

test("event input enforces real edition range and strict payload keys", () => {
  assert.deepEqual(validateCreateEvent(event()), event());
  validateCreateEvent({ ...event(), yearStart: 2000, yearEnd: 2100 });
  for (const changes of [{ competitionId: "" }, { editionLabel: "" }, { trackName: "" }, { stage: " " }, { yearStart: 1999 }, { yearEnd: 2101 }, { yearStart: 2027 }, { yearEnd: 2026.5 }, { sourceDocumentIds: [] }]) rejects(() => validateCreateEvent({ ...event(), ...changes }));
});

test("evidence inputs reject unsafe references and consistently deduplicate identical citations", () => {
  assert.deepEqual(validateEvidenceInputs([evidence(), evidence(), evidence("content.summary", "doc-1", "chunk-2")]), [evidence(), evidence("content.summary", "doc-1", "chunk-2")]);
  for (const invalid of [null, {}, [null], [{ ...evidence(), fieldPath: "bogus" }], [{ ...evidence(), chunkId: "" }], [{ ...evidence(), documentId: "x".repeat(161) }], [{ ...evidence(), extra: 1 }], Array(3001).fill(evidence())]) rejects(() => validateEvidenceInputs(invalid));
  assert.equal(validateEvidenceInputs(Array(3000).fill(evidence())).length, 1);
});

test("drafts allow pending review but require selected source and existing field references", () => {
  const draftBody = body({ "content.summary": field("text", "待核实", "unreviewed"), "team.studentMax": field("integer", 3, "conflict") });
  assert.deepEqual(validateSaveDraft({ expectedRevision: 0, body: draftBody, evidence: [evidence()] }), { expectedRevision: 0, body: draftBody, evidence: [evidence()] });
  for (const changes of [{ expectedRevision: -1 }, { expectedRevision: 1.5 }, { evidence: [evidence("content.entryPath")] }, { evidence: [evidence("content.summary", "not-selected")] }, { extra: 1 }]) rejects(() => validateSaveDraft({ expectedRevision: 0, body: draftBody, evidence: [], ...changes }));
  const parsed = validateSaveDraft({ expectedRevision: 0, body: draftBody, evidence: [] });
  draftBody.fields["content.summary"]!.value = "changed";
  assert.equal(parsed.body.fields["content.summary"]?.value, "待核实");
});

test("publication permits unknowns but requires confirmed applicable sources and a substantive official field", () => {
  assert.ok(collectPublicationIssues(emptyRuleBody(), []).length > 0);
  const valid = body({ "content.summary": field("text", "编程比赛"), "team.studentMax": field("integer", null, "unknown"), "tags.skills": field("texts", ["编程"], "confirmed", "建议掌握编程") });
  assert.deepEqual(collectPublicationIssues(valid, [evidence()]), []);
  assert.ok(collectPublicationIssues(body({ "school.name": field("text", "学校") }), [evidence("school.name")]).length > 0);
  assert.ok(collectPublicationIssues(body({ "tags.skills": field("texts", ["编程"], "confirmed", "建议") }), []).length > 0);
  for (const source of [{ ...valid.sources[0], confirmed: false }, { ...valid.sources[0], applicabilityNote: " " }]) assert.ok(collectPublicationIssues({ ...valid, sources: [source] }, [evidence()]).length > 0);
  assert.ok(collectPublicationIssues({ ...valid, sources: [...valid.sources, { documentId: "doc-2", confirmed: false, applicabilityNote: "适用" }] }, [evidence()]).some(issue => issue.fieldPath.includes("sources")));
});

test("publication issues identify unresolved fields, missing official evidence, and undocumented tags", () => {
  for (const state of ["conflict", "unreviewed"] as const) assert.ok(collectPublicationIssues(body({ "content.summary": field("text", "x", state) }), [evidence()]).some(issue => issue.fieldPath === "content.summary"));
  const input = body({ "content.summary": field("text", "x"), "team.studentMax": field("integer", 3), "tags.skills": field("texts", ["编程"]) });
  const issues = collectPublicationIssues(input, [evidence()]);
  assert.ok(issues.some(issue => issue.fieldPath === "team.studentMax"));
  assert.ok(issues.some(issue => issue.fieldPath === "tags.skills"));
  assert.ok(!issues.some(issue => issue.fieldPath === "content.summary"));
  assert.ok(collectPublicationIssues(body({ "content.summary": field("text", "x") }), [evidence("content.summary", "other-doc")]).some(issue => issue.fieldPath === "content.summary"));
});

test("each deadline and material requires its own publication evidence", () => {
  const input = body({ "content.summary": field("text", "x"), "deadlines.submit": field("date", { itemId: "submit", name: "提交", stage: "", precision: "date", value: "2026-07-20", timezone: "Asia/Shanghai" }), "materials.video": field("material", { itemId: "video", name: "视频", stage: "", requirement: "required", condition: "" }) });
  const issues = collectPublicationIssues(input, [evidence(), evidence("deadlines.submit")]);
  assert.ok(issues.some(issue => issue.fieldPath === "materials.video"));
  assert.ok(!issues.some(issue => issue.fieldPath === "deadlines.submit"));
  assert.deepEqual(collectPublicationIssues(input, [evidence(), evidence("deadlines.submit"), evidence("materials.video")]), []);
});
