import {
  CompetitionError, FIELD_DEFINITIONS,
  type CreateCompetition, type CreateEvent, type Deadline, type EvidenceInput, type FieldPath,
  type Material, type PublicationIssue, type RuleBody, type RuleField, type RuleKind,
  type RuleSource, type RuleValue, type SaveDraft,
  type EventDetail,
} from "./types";
import type { DocumentKind } from "../types";

const fixedKinds = new Map<string, RuleKind>(FIELD_DEFINITIONS.map(({ path, kind }) => [path, kind]));
const ITEM_ID = /^[A-Za-z0-9_-]{1,80}$/;

function fail(message: string): never {
  throw new CompetitionError(message);
}

// Validate data properties before reading values, including on objects passed directly by callers.
function object(value: unknown, label: string, keys?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label}必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label}必须是普通对象`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || key === "__proto__" || key === "constructor" || key === "prototype" || (keys && !keys.includes(key))) fail(`${label}包含未知属性`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) fail(`${label}包含无效属性`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) fail(`${label}必须是最多${max}项的数组`);
  if (Reflect.ownKeys(value).length !== value.length + 1) fail(`${label}包含无效数组属性`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(`${label}包含无效数组项`);
  }
  return value;
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) fail(`${label}必须是${allowEmpty ? "" : "非空"}文本，最多${max}字`);
  return value;
}

function integer(value: unknown, label: string, min = 0, max = 1000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(`${label}必须是${min}至${max}的整数`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label}必须是布尔值`);
  return value;
}

function choice<T extends string>(value: unknown, label: string, choices: readonly T[]): T {
  for (const candidate of choices) if (value === candidate) return candidate;
  return fail(`${label}取值无效`);
}

function pathInfo(value: unknown): { path: FieldPath; kind: RuleKind; itemId?: string } {
  const path = text(value, "字段路径", 80);
  const fixed = fixedKinds.get(path);
  if (fixed) return { path: path as FieldPath, kind: fixed };
  const match = /^(deadlines|materials)\.([A-Za-z0-9_-]+)$/.exec(path);
  if (!match || !ITEM_ID.test(match[2])) fail("未知字段路径");
  return { path: path as FieldPath, kind: match[1] === "deadlines" ? "date" : "material", itemId: match[2] };
}

export function validateCalendar(value: string, precision: "date" | "datetime"): void {
  if (typeof value !== "string" || (precision !== "date" && precision !== "datetime")) fail("日期精度或取值无效");
  const pattern = precision === "date" ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/;
  const match = pattern.exec(value);
  if (!match) fail("日期格式与精度不一致");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail("日期不存在");
  if (precision === "datetime" && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59)) fail("时间不存在");
}

function deadline(value: unknown, itemId: string): Deadline {
  const input = object(value, "截止日期", ["itemId", "name", "stage", "precision", "value", "timezone"]);
  if (input.itemId !== itemId) fail("截止日期标识必须与字段路径一致");
  const precision = choice(input.precision, "日期精度", ["date", "datetime"]);
  const dateValue = text(input.value, "日期", 40);
  validateCalendar(dateValue, precision);
  return { itemId, name: text(input.name, "截止事项", 160), stage: text(input.stage, "阶段", 160, true), precision, value: dateValue, timezone: choice(input.timezone, "时区", ["Asia/Shanghai"]) };
}

function material(value: unknown, itemId: string): Material {
  const input = object(value, "材料", ["itemId", "name", "stage", "requirement", "condition"]);
  if (input.itemId !== itemId) fail("材料标识必须与字段路径一致");
  return { itemId, name: text(input.name, "材料名称", 160), stage: text(input.stage, "阶段", 160, true), requirement: choice(input.requirement, "材料要求", ["required", "optional", "unknown"]), condition: text(input.condition, "材料条件", 2000, true) };
}

function ruleField(value: unknown, info: ReturnType<typeof pathInfo>): RuleField {
  const input = object(value, info.path, ["kind", "value", "state", "note"]);
  if (input.kind !== info.kind) fail(`${info.path}字段类型不一致`);
  const state = choice(input.state, "审核状态", ["unknown", "unreviewed", "confirmed", "conflict"]);
  const note = text(input.note, "备注", 2000, true);
  if (state === "unknown") {
    if (input.value !== null) fail("未知字段的值必须为null");
    return { kind: info.kind, value: null, state, note };
  }
  let parsed: RuleValue;
  switch (info.kind) {
    case "text": parsed = text(input.value, info.path, 2000); break;
    case "texts": {
      const values = array(input.value, info.path, 30);
      if (values.length === 0) fail("列表不能为空；不限请明确填写文本");
      parsed = values.map(entry => text(entry, info.path, 80));
      break;
    }
    case "integer": parsed = info.path === "school.basisYear" ? integer(input.value, info.path, 2000, 2100) : integer(input.value, info.path); break;
    case "boolean": parsed = boolean(input.value, info.path); break;
    case "date": parsed = deadline(input.value, info.itemId!); break;
    case "material": parsed = material(input.value, info.itemId!); break;
  }
  return { kind: info.kind, value: parsed, state, note };
}

export function validateBody(value: unknown): RuleBody {
  const input = object(value, "规则", ["schemaVersion", "sources", "fields"]);
  if (input.schemaVersion !== 1) fail("不支持的规则版本");
  const sourceIds = new Set<string>();
  const sources: RuleSource[] = array(input.sources, "来源", 30).map(value => {
    const source = object(value, "来源", ["documentId", "applicabilityNote", "confirmed"]);
    const documentId = text(source.documentId, "来源文档ID", 160);
    if (sourceIds.has(documentId)) fail("来源文档ID重复");
    sourceIds.add(documentId);
    return { documentId, applicabilityNote: text(source.applicabilityNote, "适用说明", 500, true), confirmed: boolean(source.confirmed, "来源确认") };
  });
  const inputFields = object(input.fields, "规则字段");
  if (Object.keys(inputFields).length > 100) fail("规则字段最多100项");
  const fields: RuleBody["fields"] = {};
  let deadlines = 0;
  let materials = 0;
  for (const [path, value] of Object.entries(inputFields)) {
    const info = pathInfo(path);
    if (info.kind === "date" && ++deadlines > 20) fail("截止日期最多20项");
    if (info.kind === "material" && ++materials > 20) fail("材料最多20项");
    fields[info.path] = ruleField(value, info);
  }
  for (const [minPath, maxPath] of [["team.studentMin", "team.studentMax"], ["team.teacherMin", "team.teacherMax"]] as const) {
    const min = fields[minPath]?.value;
    const max = fields[maxPath]?.value;
    if (typeof min === "number" && typeof max === "number" && min > max) fail(`${minPath}不能超过${maxPath}`);
  }
  const body: RuleBody = { schemaVersion: 1, sources, fields };
  if (new TextEncoder().encode(JSON.stringify(body)).length > 65536) fail("规则内容不能超过65536字节");
  return body;
}

export function validateCreateCompetition(value: unknown): CreateCompetition {
  const input = object(value, "赛事", ["name", "aliases", "catalogNumber", "catalogYear", "officialUrl"]);
  let officialUrl = text(input.officialUrl, "官网地址", 2000, true).trim();
  if (officialUrl) {
    let url: URL;
    try { url = new URL(officialUrl); } catch { return fail("官网地址无效"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail("官网地址必须为无账号密码的HTTP或HTTPS地址");
    officialUrl = url.href;
  }
  return {
    name: text(input.name, "赛事名称", 160),
    aliases: array(input.aliases, "赛事别名", 30).map(value => text(value, "赛事别名", 160)),
    catalogNumber: input.catalogNumber === null ? null : integer(input.catalogNumber, "目录编号", 1, Number.MAX_SAFE_INTEGER),
    catalogYear: input.catalogYear === null ? null : integer(input.catalogYear, "目录年份", 2000, 2100),
    officialUrl,
  };
}

export function validateCreateEvent(value: unknown): CreateEvent {
  const input = object(value, "届次", ["competitionId", "editionLabel", "yearStart", "yearEnd", "trackName", "stage"]);
  const yearStart = integer(input.yearStart, "起始年份", 2000, 2100);
  const yearEnd = integer(input.yearEnd, "结束年份", 2000, 2100);
  if (yearStart > yearEnd) fail("起始年份不能超过结束年份");
  return { competitionId: text(input.competitionId, "赛事ID", 160), editionLabel: text(input.editionLabel, "届次名称", 160), yearStart, yearEnd, trackName: text(input.trackName, "赛道名称", 160), stage: text(input.stage, "阶段", 160) };
}

export function validateEvidenceInputs(value: unknown): EvidenceInput[] {
  const seen = new Set<string>();
  const evidence: EvidenceInput[] = [];
  for (const entry of array(value, "证据", 100 * 30)) {
    const input = object(entry, "证据", ["fieldPath", "documentId", "chunkId"]);
    const parsed: EvidenceInput = { fieldPath: pathInfo(input.fieldPath).path, documentId: text(input.documentId, "文档ID", 160), chunkId: text(input.chunkId, "片段ID", 160) };
    const key = JSON.stringify([parsed.fieldPath, parsed.documentId, parsed.chunkId]);
    if (!seen.has(key)) { seen.add(key); evidence.push(parsed); }
  }
  return evidence;
}

export function validateSaveDraft(value: unknown): SaveDraft {
  const input = object(value, "草稿", ["expectedRevision", "body", "evidence"]);
  const expectedRevision = integer(input.expectedRevision, "编辑修订号", 0, Number.MAX_SAFE_INTEGER);
  const body = validateBody(input.body);
  const evidence = validateEvidenceInputs(input.evidence);
  const sourceIds = new Set(body.sources.map(source => source.documentId));
  for (const entry of evidence) {
    if (!Object.hasOwn(body.fields, entry.fieldPath)) fail("证据必须引用现有字段");
    if (!sourceIds.has(entry.documentId)) fail("证据文档必须属于选定来源");
  }
  return { expectedRevision, body, evidence };
}

export function validateRevision(value: unknown): number {
  return integer(value, "编辑修订号", 0, Number.MAX_SAFE_INTEGER);
}

export type SourceMetadata = { id: string; title: string; competition: string; kind: DocumentKind; year: string; stage: string };

// Only explicit metadata is used here; these guards do not infer rules from source prose.
function yearRanges(text: string): Array<[number, number]> {
  return Array.from(text.matchAll(/(20\d{2})(?:\s*[-—–~～至/]\s*(20\d{2}))?/g), match => [Number(match[1]), Number(match[2] ?? match[1])]);
}

const trackMarkers = /软件赛|硬件赛|电子赛|人工智能赛|软件应用与开发|数字媒体设计|大数据应用|信息可视化设计|(?:[A-Z]组)|(?:[A-Z]类)/gi;
const stageMarkers = /校赛|省赛|全国总决赛|全国赛|国赛|总决赛|初赛|复赛|决赛/g;
function stages(text: string): string[] {
  return Array.from(text.matchAll(stageMarkers), match => /^(全国总决赛|全国赛|国赛|总决赛)$/.test(match[0]) ? "国赛" : match[0]);
}

function softwareSubjects(text: string): string[] {
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  if (!normalized.includes("软件赛") || /软件赛(?:全部|所有|全)科目/.test(normalized)) return [];
  return Array.from(normalized.matchAll(/python|java|c\/c\+\+|c\+\+|(?<![a-z])c(?![a-z])|web|网络安全|软件测试/g),
    match => /^c/.test(match[0]) ? "c/c++" : match[0]);
}

export function collectSourceIssues(detail: Pick<EventDetail, "competition" | "event">, body: RuleBody, evidence: EvidenceInput[], documents: Map<string, SourceMetadata>): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  const add = (fieldPath: string, message: string) => issues.push({ fieldPath, message });
  const { competition, event } = detail;
  for (const source of body.sources) {
    const document = documents.get(source.documentId);
    if (!document) { add("sources", "选定来源已不存在"); continue; }
    const schoolOnly = document.kind === "catalog" || document.kind === "policy";
    if (schoolOnly) {
      if (!/学校|认定|school/i.test(source.applicabilityNote)) add("sources", "目录或管理政策须明确仅适用于学校认定背景");
    } else {
      const scopeText = `${document.title} ${document.competition}`;
      const names = [competition.name, ...competition.aliases];
      if (!names.some(name => scopeText.includes(name)) && !scopeText.includes(event.trackName)) add("sources", "来源赛事或赛道不相符");
      for (const metadata of [document.year, document.title]) {
        const ranges = yearRanges(metadata);
        if (ranges.length && !ranges.some(([start, end]) => start <= event.yearEnd && end >= event.yearStart)) add("sources", "来源明确年份与届次不相符");
      }
      if (!yearRanges(`${document.year} ${document.title}`).length && (!source.confirmed || !source.applicabilityNote.trim())) add("sources", "无明确年份的来源须人工确认适用范围");
      // Expand explicit shared group notation before matching individual group markers.
      const trackText = scopeText.replace(/([A-Z](?:\s*[/、与和]\s*[A-Z])+)(组|类)/gi,
        (_, letters: string, suffix: string) => (letters.match(/[A-Z]/gi) ?? []).map(letter => `${letter}${suffix}`).join("、"));
      const tracks = Array.from(trackText.matchAll(trackMarkers), match => match[0].toLowerCase());
      const eventTrack = event.trackName.toLowerCase();
      if (tracks.length && !tracks.some(track => eventTrack.includes(track) || track.includes(eventTrack))) add("sources", "来源明确赛道与当前赛道不相符");
      const sourceSubjects = softwareSubjects(scopeText);
      const eventSubjects = softwareSubjects(event.trackName);
      if (sourceSubjects.length && eventSubjects.length && !sourceSubjects.some(subject => eventSubjects.includes(subject))) add("sources", "来源明确软件赛科目与当前科目不相符");
      const sourceStages = stages(`${document.title} ${document.stage}`);
      const eventStages = stages(event.stage);
      if (sourceStages.length && eventStages.length && !sourceStages.some(stage => eventStages.includes(stage))) add("sources", "来源明确阶段与当前阶段不相符");
    }
    if (!source.applicabilityNote.trim()) add("sources", "每个来源均须填写适用说明");
  }
  for (const entry of evidence) {
    const document = documents.get(entry.documentId);
    if (!document) { add(entry.fieldPath, "证据文档已不存在"); continue; }
    if ((document.kind === "catalog" || document.kind === "policy") && !entry.fieldPath.startsWith("school.")) add(entry.fieldPath, "目录或管理政策不能证明官方参赛规则");
  }
  const category = body.fields["school.category"];
  if (category?.state === "confirmed" && category.value !== null) {
    const school = body.fields["school.name"];
    const basis = body.fields["school.basisYear"];
    if (school?.state !== "confirmed" || school.value === null || basis?.state !== "confirmed" || basis.value !== event.yearEnd) add("school.category", "学校类别须有已确认学校名称与当前届次适用年");
    const categoryProof = evidence.filter(entry => entry.fieldPath === "school.category");
    if (!categoryProof.some(entry => {
      const document = documents.get(entry.documentId);
      if (!document) return false;
      const ranges = yearRanges(`${document.year} ${document.title}`);
      return ranges.length > 0 && ranges.every(([start, end]) => start === basis?.value && end === basis?.value);
    })) add("school.category", "学校认定原文年份须与认定适用年和赛事结束年一致");
  }
  return issues;
}

export function collectPublicationIssues(body: RuleBody, evidence: EvidenceInput[]): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  const add = (fieldPath: string, message: string) => issues.push({ fieldPath, message });
  if (!body.sources.some(source => source.confirmed && source.applicabilityNote.trim())) add("sources", "至少需要一个已确认且填写适用说明的来源");
  const sourceIds = new Set<string>();
  for (const source of body.sources) {
    if (!source.confirmed) add("sources", `来源${source.documentId}尚未确认`);
    if (sourceIds.has(source.documentId)) add("sources", `来源${source.documentId}重复`);
    sourceIds.add(source.documentId);
  }
  const referencedFields = new Set(evidence.filter(entry => sourceIds.has(entry.documentId)).map(entry => entry.fieldPath));
  let hasSubstantiveField = false;
  for (const [path, field] of Object.entries(body.fields)) {
    if (!field) continue;
    if (field.value === null && field.state === "unknown") continue;
    if (field.state !== "confirmed") add(path, "字段须确认后才能发布");
    if (path.startsWith("tags.")) {
      if (!field.note.trim()) add(path, "建议标签必须填写说明");
    } else {
      if (!referencedFields.has(path as FieldPath)) add(path, "规则字段缺少对应原文证据");
      if (/^(content|student|team)\./.test(path) && field.state === "confirmed" && field.value !== null) hasSubstantiveField = true;
    }
  }
  if (!hasSubstantiveField) add("fields", "至少需要一个已确认的比赛内容、学生或团队规则字段");
  return issues;
}
