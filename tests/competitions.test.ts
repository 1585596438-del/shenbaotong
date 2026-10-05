import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "node:path";
import { competitionFixture } from "./helpers/competition-fixture";
import { CompetitionError, FIELD_DEFINITIONS, emptyRuleBody, type FieldPath, type RuleBody, type RuleField } from "../src/server/competitions/types";
import { collectPublicationIssues, validateBody, validateCalendar, validateCreateCompetition, validateCreateEvent, validateEvidenceInputs, validateSaveDraft } from "../src/server/competitions/validation";

const field = (kind: RuleField["kind"], value: RuleField["value"], state: RuleField["state"] = "confirmed", note = ""): RuleField => ({ kind, value, state, note });
const body = (fields: RuleBody["fields"] = {}): RuleBody => ({ schemaVersion: 1, sources: [{ documentId: "doc-1", applicabilityNote: "适用于2026全国赛", confirmed: true }], fields });
const competition = () => ({ name: "测试赛", aliases: ["别名"], catalogNumber: null, catalogYear: null, officialUrl: "" });
const event = () => ({ competitionId: "competition-1", editionLabel: "第十届", yearStart: 2026, yearEnd: 2026, trackName: "通用", stage: "全国赛" });
const evidence = (fieldPath: FieldPath = "content.summary", documentId = "doc-1", chunkId = "chunk-1") => ({ fieldPath, documentId, chunkId });
const rejects = (fn: () => unknown) => assert.throws(fn, (error: unknown) => error instanceof CompetitionError && error.status === 400);

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
