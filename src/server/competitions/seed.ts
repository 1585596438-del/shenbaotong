import { createHash } from "node:crypto";
import type { KnowledgeStore } from "../store";
import { CompetitionError, type CreateCompetition, type CreateEvent, type EvidenceInput, type FieldPath, type RuleBody, type RuleField } from "./types";
import { validateBody, validateCreateCompetition, validateCreateEvent, validateSaveDraft } from "./validation";

export type SeedManifest = {
  schemaVersion: 1;
  entries: Array<{
    competition: CreateCompetition;
    event: Omit<CreateEvent, "competitionId">;
    sources: Array<{ key: string; url: string; textSha256: string }>;
    fields: Array<{ path: FieldPath; field: RuleField; evidence: Array<{ sourceKey: string; anchor: string }> }>;
  }>;
};
export type SeedReport = { created: number; skipped: number; failed: Array<{ competition: string; reason: string }> };

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new CompetitionError("录入清单必须是普通对象。");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !keys.includes(key) || !("value" in descriptor) || !descriptor.enumerable) throw new CompetitionError("录入清单包含未知或无效属性。");
  }
  if (keys.some(key => !Object.hasOwn(value, key))) throw new CompetitionError("录入清单缺少必需属性。");
  return value as Record<string, unknown>;
}

function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) throw new CompetitionError("录入清单数组无效或超过上限。");
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new CompetitionError("录入清单数组项无效。");
  }
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new CompetitionError("录入清单文本无效或超过上限。");
  return value;
}

export function validateSeedManifest(value: unknown): SeedManifest {
  const root = object(value, ["schemaVersion", "entries"]);
  if (root.schemaVersion !== 1) throw new CompetitionError("不支持的录入清单版本。");
  const entries = array(root.entries, 100).map(value => {
    const entry = object(value, ["competition", "event", "sources", "fields"]);
    const competition = validateCreateCompetition(entry.competition);
    const rawEvent = object(entry.event, ["editionLabel", "yearStart", "yearEnd", "trackName", "stage"]);
    const { competitionId: _id, ...event } = validateCreateEvent({ ...rawEvent, competitionId: "seed" });
    const sourceKeys = new Set<string>();
    const sources = array(entry.sources, 30).map(value => {
      const source = object(value, ["key", "url", "textSha256"]);
      const key = text(source.key, 160);
      if (sourceKeys.has(key)) throw new CompetitionError("录入来源键重复。");
      sourceKeys.add(key);
      const url = text(source.url, 2000);
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new CompetitionError("录入来源URL无效。"); }
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new CompetitionError("录入来源URL须为无账号密码的HTTP或HTTPS地址。");
      const textSha256 = text(source.textSha256, 64);
      if (!/^[a-f0-9]{64}$/.test(textSha256)) throw new CompetitionError("录入正文sha256无效。");
      return { key, url, textSha256 };
    });
    const rawFields: Record<string, unknown> = {};
    const fieldEntries = array(entry.fields, 100).map(value => {
      const field = object(value, ["path", "field", "evidence"]);
      const path = text(field.path, 80);
      if (Object.hasOwn(rawFields, path)) throw new CompetitionError("录入字段路径重复。");
      // Define a data property so even a hostile path reaches the shared field validator safely.
      Object.defineProperty(rawFields, path, { value: field.field, enumerable: true });
      const evidence = array(field.evidence, 3000).map(value => {
        const proof = object(value, ["sourceKey", "anchor"]);
        const sourceKey = text(proof.sourceKey, 160);
        if (!sourceKeys.has(sourceKey)) throw new CompetitionError("原文依据引用未知来源键。");
        return { sourceKey, anchor: text(proof.anchor, 2000) };
      });
      return { path, evidence };
    });
    const body = validateBody({ schemaVersion: 1, sources: [], fields: rawFields });
    const fields = fieldEntries.map(({ path, evidence }) => ({ path: path as FieldPath, field: body.fields[path as FieldPath]!, evidence }));
    return { competition, event, sources, fields };
  });
  return { schemaVersion: 1, entries };
}

export function findAnchorChunks(chunks: Array<{ id: string; text: string }>, anchor: string): string[] {
  const text = chunks.map(chunk => chunk.text).join("");
  const start = text.indexOf(anchor);
  if (!anchor || start < 0 || text.indexOf(anchor, start + 1) >= 0) throw new CompetitionError("原文锚点缺失或不唯一，请核对资料。");
  const end = start + anchor.length;
  let offset = 0;
  return chunks.filter(chunk => { const begin = offset; offset += chunk.text.length; return begin < end && offset > start; }).map(chunk => chunk.id);
}

function existingEvent(store: KnowledgeStore, entry: SeedManifest["entries"][number]) {
  return store.competitions.list().find(({ competition, event }) => competition.name === entry.competition.name
    && event.editionLabel === entry.event.editionLabel && event.trackName === entry.event.trackName && event.stage === entry.event.stage)?.event;
}

export function seedCompetitionRules(store: KnowledgeStore, manifest: SeedManifest): SeedReport {
  const parsed = validateSeedManifest(manifest);
  const report: SeedReport = { created: 0, skipped: 0, failed: [] };
  for (const entry of parsed.entries) {
    try {
      const existing = existingEvent(store, entry);
      if (existing && store.competitions.getDetail(existing.id).versions.length) { report.skipped++; continue; }
      // Resolve every source and anchor before creating any record for this entry.
      const documents = store.listDocuments();
      const resolved = new Map(entry.sources.map(source => {
        const matches = documents.filter(document => document.sourceUrl === source.url).filter(document => {
          const restoredText = store.getChunks([document.id]).map(chunk => chunk.text).join("");
          return createHash("sha256").update(restoredText).digest("hex") === source.textSha256;
        });
        if (matches.length !== 1) throw new CompetitionError(`来源 ${source.key} 的URL与正文sha256匹配${matches.length}份资料，须唯一匹配。`);
        const document = matches[0];
        return [source.key, { documentId: document.id, chunks: store.getChunks([document.id]) }] as const;
      }));
      const body: RuleBody = { schemaVersion: 1, sources: [], fields: {} };
      const evidence: EvidenceInput[] = [];
      const selectedIds = new Set<string>();
      for (const source of entry.sources) {
        const { documentId } = resolved.get(source.key)!;
        if (!selectedIds.has(documentId)) body.sources.push({ documentId, applicabilityNote: "", confirmed: false });
        selectedIds.add(documentId);
      }
      for (const { path, field, evidence: anchors } of entry.fields) {
        body.fields[path] = { ...field, state: field.value === null ? "unknown" : "unreviewed" };
        for (const anchor of anchors) {
          const source = resolved.get(anchor.sourceKey)!;
          for (const chunkId of findAnchorChunks(source.chunks, anchor.anchor)) evidence.push({ fieldPath: path, documentId: source.documentId, chunkId });
        }
      }
      const draftInput = validateSaveDraft({ expectedRevision: 0, body, evidence });
      const created = store.competitions.runInTransaction(() => {
        const event = existingEvent(store, entry);
        if (event && store.competitions.getDetail(event.id).versions.length) return false;
        const competition = store.competitions.listCompetitions().find(c => c.name === entry.competition.name)
          ?? store.competitions.createCompetition(entry.competition);
        const target = event ?? store.competitions.createEvent({ ...entry.event, competitionId: competition.id });
        const draft = store.competitions.ensureDraft(target.id);
        store.competitions.saveDraft(draft.id, { ...draftInput, expectedRevision: draft.editRevision });
        return true;
      });
      if (created) report.created++; else report.skipped++;
    } catch (error) {
      report.failed.push({ competition: entry.competition.name, reason: error instanceof Error ? error.message : "规则草稿录入失败。" });
    }
  }
  return report;
}
