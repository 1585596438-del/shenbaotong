import test from "node:test";
import assert from "node:assert/strict";
import { CompetitionError, FIELD_DEFINITIONS, emptyRuleBody, type FieldPath, type RuleBody, type RuleField } from "../src/server/competitions/types";
import { collectPublicationIssues, validateBody, validateCalendar, validateCreateCompetition, validateCreateEvent, validateEvidenceInputs, validateSaveDraft } from "../src/server/competitions/validation";

const field = (kind: RuleField["kind"], value: RuleField["value"], state: RuleField["state"] = "confirmed", note = ""): RuleField => ({ kind, value, state, note });
const body = (fields: RuleBody["fields"] = {}): RuleBody => ({ schemaVersion: 1, sources: [{ documentId: "doc-1", applicabilityNote: "适用于2026全国赛", confirmed: true }], fields });
const competition = () => ({ name: "测试赛", aliases: ["别名"], catalogNumber: null, catalogYear: null, officialUrl: "" });
const event = () => ({ competitionId: "competition-1", editionLabel: "第十届", yearStart: 2026, yearEnd: 2026, trackName: "通用", stage: "全国赛" });
const evidence = (fieldPath: FieldPath = "content.summary", documentId = "doc-1", chunkId = "chunk-1") => ({ fieldPath, documentId, chunkId });
const rejects = (fn: () => unknown) => assert.throws(fn, (error: unknown) => error instanceof CompetitionError && error.status === 400);

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
