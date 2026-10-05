import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  CompetitionError, type Competition, type CompetitionEvent, type CreateCompetition,
  type CreateEvent, type EventDetail, type EvidenceInput, type RuleBody, type RuleVersion, type SaveDraft,
  emptyRuleBody,
} from "./types";
import { collectPublicationIssues, collectSourceIssues, validateCreateCompetition, validateCreateEvent, validateRevision, validateSaveDraft, type SourceMetadata } from "./validation";

type CompetitionRow = Omit<Competition, "aliases"> & { aliasesJson: string };
type EventRow = Omit<CompetitionEvent, "sourceDocumentIds"> & { sourceDocumentIdsJson: string };
type VersionRow = Omit<RuleVersion, "body" | "evidence"> & { bodyJson: string };
type CompetitionListItem = Pick<EventDetail, "competition" | "event" | "current" | "draft">;

function parseCompetition(row: CompetitionRow): Competition {
  return {
    id: row.id, name: row.name, aliases: JSON.parse(row.aliasesJson) as string[],
    catalogNumber: row.catalogNumber, catalogYear: row.catalogYear,
    officialUrl: row.officialUrl, createdAt: row.createdAt,
  };
}

function parseEvent(row: EventRow): CompetitionEvent {
  return {
    id: row.id, competitionId: row.competitionId, editionLabel: row.editionLabel,
    yearStart: row.yearStart, yearEnd: row.yearEnd, trackName: row.trackName, stage: row.stage,
    sourceDocumentIds: JSON.parse(row.sourceDocumentIdsJson) as string[], createdAt: row.createdAt,
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE";
}

export class CompetitionStore {
  constructor(private readonly db: Database.Database) {
    this.execute(() => db.exec(`
      CREATE TABLE IF NOT EXISTS competitions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, aliasesJson TEXT NOT NULL,
        catalogNumber INTEGER, catalogYear INTEGER, officialUrl TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS competition_events (
        id TEXT PRIMARY KEY, competitionId TEXT NOT NULL REFERENCES competitions(id),
        editionLabel TEXT NOT NULL, yearStart INTEGER NOT NULL, yearEnd INTEGER NOT NULL,
        trackName TEXT NOT NULL, stage TEXT NOT NULL, sourceDocumentIdsJson TEXT NOT NULL, createdAt TEXT NOT NULL,
        UNIQUE(competitionId, editionLabel, trackName, stage)
      );
      CREATE TABLE IF NOT EXISTS competition_rule_versions (
        id TEXT PRIMARY KEY, eventId TEXT NOT NULL REFERENCES competition_events(id),
        version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published','archived','needs_review')),
        bodyJson TEXT NOT NULL, editRevision INTEGER NOT NULL, createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL, publishedAt TEXT, UNIQUE(eventId, version)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS competition_one_draft ON competition_rule_versions(eventId) WHERE status='draft';
      CREATE UNIQUE INDEX IF NOT EXISTS competition_one_publication ON competition_rule_versions(eventId) WHERE status='published';
      CREATE TABLE IF NOT EXISTS competition_rule_evidence (
        id TEXT PRIMARY KEY, versionId TEXT NOT NULL REFERENCES competition_rule_versions(id) ON DELETE CASCADE,
        fieldPath TEXT NOT NULL, documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunkId TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE, UNIQUE(versionId, fieldPath, chunkId)
      );
      CREATE INDEX IF NOT EXISTS competition_evidence_document ON competition_rule_evidence(documentId);
    `));
  }

  createCompetition(input: CreateCompetition): Competition {
    const parsed = validateCreateCompetition(input);
    return this.execute(() => {
      const competition: Competition = { ...parsed, id: randomUUID(), createdAt: new Date().toISOString() };
      try {
        this.db.prepare(`INSERT INTO competitions
          (id,name,aliasesJson,catalogNumber,catalogYear,officialUrl,createdAt) VALUES (?,?,?,?,?,?,?)`)
          .run(competition.id, competition.name, JSON.stringify(competition.aliases), competition.catalogNumber,
            competition.catalogYear, competition.officialUrl, competition.createdAt);
      } catch (error) {
        if (isUniqueConstraint(error)) throw new CompetitionError("该赛事名称已存在。", 409);
        throw error;
      }
      return competition;
    });
  }

  createEvent(input: CreateEvent): CompetitionEvent {
    const parsed = validateCreateEvent(input);
    return this.execute(() => this.db.transaction(() => {
      this.getCompetition(parsed.competitionId);
      const event: CompetitionEvent = { ...parsed, id: randomUUID(), sourceDocumentIds: [], createdAt: new Date().toISOString() };
      try {
        this.db.prepare(`INSERT INTO competition_events
          (id,competitionId,editionLabel,yearStart,yearEnd,trackName,stage,sourceDocumentIdsJson,createdAt)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(event.id, event.competitionId, event.editionLabel, event.yearStart,
            event.yearEnd, event.trackName, event.stage, JSON.stringify(event.sourceDocumentIds), event.createdAt);
      } catch (error) {
        if (isUniqueConstraint(error)) throw new CompetitionError("该赛事的届次、赛道和阶段已存在。", 409);
        throw error;
      }
      return event;
    })());
  }

  listCompetitions(): Competition[] {
    return this.execute(() => {
      const rows = this.db.prepare("SELECT * FROM competitions ORDER BY createdAt DESC,id").all() as CompetitionRow[];
      return rows.map(parseCompetition);
    });
  }

  list(): CompetitionListItem[] {
    return this.execute(() => this.db.transaction(() => {
      const rows = this.db.prepare("SELECT id FROM competition_events ORDER BY createdAt DESC,id").all() as { id: string }[];
      return rows.map(({ id }) => {
        const { competition, event, current, draft } = this.getDetail(id);
        return { competition, event, current, draft };
      });
    })());
  }

  getDetail(eventId: string): EventDetail {
    return this.execute(() => this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM competition_events WHERE id=?").get(eventId) as EventRow | undefined;
      if (!row) throw new CompetitionError("未找到该赛事届次。", 404);
      const event = parseEvent(row);
      const competition = this.getCompetition(event.competitionId);
      const rows = this.db.prepare("SELECT * FROM competition_rule_versions WHERE eventId=? ORDER BY version DESC").all(eventId) as VersionRow[];
      const versions = rows.map(version => this.parseVersion(version));
      return {
        competition, event, versions,
        current: versions.find(version => version.status === "published") ?? null,
        draft: versions.find(version => version.status === "draft") ?? null,
      };
    })());
  }

  getVersion(versionId: string): RuleVersion {
    return this.execute(() => this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM competition_rule_versions WHERE id=?").get(versionId) as VersionRow | undefined;
      if (!row) throw new CompetitionError("未找到该规则版本。", 404);
      return this.parseVersion(row);
    })());
  }

  ensureDraft(eventId: string): RuleVersion {
    return this.execute(() => this.db.transaction(() => {
      const detail = this.getDetail(eventId);
      if (detail.draft) return detail.draft;
      const latest = detail.versions[0];
      const ancestor = latest?.status === "needs_review" ? latest : detail.current;
      const body = ancestor ? validateSaveDraft({ expectedRevision: 0, body: ancestor.body, evidence: [] }).body : emptyRuleBody();
      const documents = this.sourceDocuments(body);
      body.sources = body.sources.filter(source => {
        const document = documents.get(source.documentId);
        return document && collectSourceIssues(detail, { ...body, sources: [{ ...source, confirmed: true }] }, [], new Map([[document.id, document]]))
          .every(issue => issue.fieldPath !== "sources");
      });
      const selectedIds = new Set(body.sources.map(source => source.documentId));
      const evidence = (ancestor?.evidence ?? []).filter(entry => selectedIds.has(entry.documentId)
        && Object.hasOwn(body.fields, entry.fieldPath) && this.proofExists(entry)
        && collectSourceIssues(detail, body, [entry], documents).every(issue => issue.fieldPath !== entry.fieldPath));
      if (ancestor?.status === "needs_review") for (const source of body.sources) source.confirmed = false;
      const backedFields = new Set(evidence.map(entry => entry.fieldPath));
      for (const [path, field] of Object.entries(body.fields)) {
        if (field && field.value !== null && (ancestor?.status === "needs_review"
          || (!path.startsWith("tags.") && !backedFields.has(path as EvidenceInput["fieldPath"])))) field.state = "unreviewed";
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO competition_rule_versions
        (id,eventId,version,status,bodyJson,editRevision,createdAt,updatedAt,publishedAt) VALUES (?,?,?,'draft',?,0,?,?,NULL)`)
        .run(id, eventId, (latest?.version ?? 0) + 1, JSON.stringify(body), now, now);
      this.replaceEvidence(id, evidence);
      return this.getVersion(id);
    })());
  }

  saveDraft(versionId: string, input: SaveDraft): RuleVersion {
    const parsed = validateSaveDraft(input);
    return this.execute(() => this.db.transaction(() => {
      const version = this.getVersion(versionId);
      this.requireDraft(version, parsed.expectedRevision);
      const documents = this.sourceDocuments(parsed.body);
      if (parsed.body.sources.some(source => !documents.has(source.documentId))) throw new CompetitionError("选定来源文档已不存在。");
      if (parsed.evidence.some(entry => !this.proofExists(entry))) throw new CompetitionError("证据片段不存在或不属于所选文档。");
      this.db.prepare("UPDATE competition_rule_versions SET bodyJson=?,editRevision=editRevision+1,updatedAt=? WHERE id=?")
        .run(JSON.stringify(parsed.body), new Date().toISOString(), versionId);
      this.replaceEvidence(versionId, parsed.evidence);
      return this.getVersion(versionId);
    })());
  }

  publish(versionId: string, expectedRevision: number): RuleVersion {
    validateRevision(expectedRevision);
    return this.execute(() => this.db.transaction(() => {
      const version = this.getVersion(versionId);
      this.requireDraft(version, expectedRevision);
      // Revalidate persisted data and live references inside the same write transaction.
      const parsed = validateSaveDraft({ expectedRevision, body: version.body, evidence: version.evidence });
      const detail = this.getDetail(version.eventId);
      const issues = collectPublicationIssues(parsed.body, parsed.evidence);
      const documents = this.sourceDocuments(parsed.body);
      issues.push(...collectSourceIssues(detail, parsed.body, parsed.evidence, documents));
      for (const entry of parsed.evidence) if (!this.proofExists(entry)) issues.push({ fieldPath: entry.fieldPath, message: "证据已失效或文档与片段不匹配" });
      if (issues.length) throw new CompetitionError(issues.map(issue => `${issue.fieldPath}：${issue.message}`).join("；"));
      const now = new Date().toISOString();
      this.db.prepare("UPDATE competition_rule_versions SET status='archived',updatedAt=? WHERE eventId=? AND status='published'")
        .run(now, version.eventId);
      this.db.prepare("UPDATE competition_rule_versions SET status='published',publishedAt=?,updatedAt=?,editRevision=editRevision+1 WHERE id=?")
        .run(now, now, versionId);
      this.db.prepare("UPDATE competition_events SET sourceDocumentIdsJson=? WHERE id=?")
        .run(JSON.stringify(parsed.body.sources.map(source => source.documentId)), version.eventId);
      return this.getVersion(versionId);
    })());
  }

  private requireDraft(version: RuleVersion, revision: number): void {
    if (version.status !== "draft" || version.editRevision !== revision) throw new CompetitionError("草稿状态或编辑修订号已变化，请刷新后重试。", 409);
  }

  private sourceDocuments(body: RuleBody): Map<string, SourceMetadata> {
    const select = this.db.prepare("SELECT id,title,competition,kind,year,stage FROM documents WHERE id=?");
    const documents = new Map<string, SourceMetadata>();
    for (const source of body.sources) {
      const document = select.get(source.documentId) as SourceMetadata | undefined;
      if (document) documents.set(document.id, document);
    }
    return documents;
  }

  private proofExists(entry: EvidenceInput): boolean {
    return !!this.db.prepare("SELECT 1 FROM chunks c JOIN documents d ON d.id=c.documentId WHERE c.id=? AND c.documentId=?")
      .get(entry.chunkId, entry.documentId);
  }

  private replaceEvidence(versionId: string, evidence: EvidenceInput[]): void {
    this.db.prepare("DELETE FROM competition_rule_evidence WHERE versionId=?").run(versionId);
    const insert = this.db.prepare("INSERT INTO competition_rule_evidence (id,versionId,fieldPath,documentId,chunkId) VALUES (?,?,?,?,?)");
    for (const entry of evidence) insert.run(randomUUID(), versionId, entry.fieldPath, entry.documentId, entry.chunkId);
  }

  private getCompetition(id: string): Competition {
    const row = this.db.prepare("SELECT * FROM competitions WHERE id=?").get(id) as CompetitionRow | undefined;
    if (!row) throw new CompetitionError("未找到该赛事。", 404);
    return parseCompetition(row);
  }

  private parseVersion(row: VersionRow): RuleVersion {
    const evidence = this.db.prepare(`SELECT fieldPath,documentId,chunkId FROM competition_rule_evidence
      WHERE versionId=? ORDER BY fieldPath,documentId,chunkId`).all(row.id) as EvidenceInput[];
    return {
      id: row.id, eventId: row.eventId, version: row.version, status: row.status,
      body: JSON.parse(row.bodyJson) as RuleBody,
      evidence: evidence.map(entry => ({ fieldPath: entry.fieldPath, documentId: entry.documentId, chunkId: entry.chunkId })),
      editRevision: row.editRevision, createdAt: row.createdAt, updatedAt: row.updatedAt, publishedAt: row.publishedAt,
    };
  }

  private execute<T>(operation: () => T): T {
    try { return operation(); }
    catch (error) {
      if (error instanceof CompetitionError) throw error;
      throw new Error("赛事数据操作失败，请重试。");
    }
  }
}
