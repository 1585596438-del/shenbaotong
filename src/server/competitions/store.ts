import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  CompetitionError, type Competition, type CompetitionEvent, type CreateCompetition,
  type CreateEvent, type EventDetail, type EvidenceInput, type RuleBody, type RuleVersion,
} from "./types";
import { validateCreateCompetition, validateCreateEvent } from "./validation";

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
