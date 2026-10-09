import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { splitPages } from "./chunking";
import { CompetitionStore } from "./competitions/store";
import type { Answer, ChatDetail, ChatSession, Chunk, DocumentInput, KnowledgeDocument } from "./types";

export class StaleCitationError extends Error {
  constructor() { super("回答处理期间来源文档已被删除，请重新选择资料后提问。"); }
}

export class KnowledgeStore {
  private db: Database.Database;
  readonly competitions: CompetitionStore;

  constructor(filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        sourceUrl TEXT NOT NULL, kind TEXT NOT NULL, year TEXT NOT NULL,
        stage TEXT NOT NULL, competition TEXT NOT NULL, fileName TEXT NOT NULL,
        createdAt TEXT NOT NULL, pageCount INTEGER NOT NULL, characterCount INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY, documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL, page INTEGER, paragraph INTEGER NOT NULL,
        text TEXT NOT NULL, embedding TEXT, embeddingKey TEXT
      );
      CREATE INDEX IF NOT EXISTS chunks_document ON chunks(documentId, sequence);
      CREATE TABLE IF NOT EXISTS answers (id TEXT PRIMARY KEY, body TEXT NOT NULL, createdAt TEXT NOT NULL);
    `);
    this.competitions = new CompetitionStore(this.db);
    this.db.transaction(() => {
      const hasChats = !!this.db.prepare("SELECT name FROM sqlite_master WHERE name='chat_sessions'").get();
      this.db.exec(`CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, documentIds TEXT NOT NULL,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_answers (
        answerId TEXT PRIMARY KEY REFERENCES answers(id) ON DELETE CASCADE,
        sessionId TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE, sequence INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chat_answers_session ON chat_answers(sessionId);`);
      if (!hasChats) {
        const rows = this.db.prepare("SELECT id,createdAt FROM answers ORDER BY createdAt,id").all() as {id:string;createdAt:string}[];
        if (rows.length) {
          const id = randomUUID();
          this.db.prepare("INSERT INTO chat_sessions VALUES (?,?,?,?,?)").run(id,"历史聊天","[]",rows[0].createdAt,rows.at(-1)!.createdAt);
          const link = this.db.prepare("INSERT INTO chat_answers VALUES (?,?,?)");
          rows.forEach((row,index) => link.run(row.id,id,index));
        }
      }
    }).immediate();
  }

  listDocuments(): KnowledgeDocument[] {
    return this.db.prepare(`SELECT d.*, COUNT(c.id) AS chunkCount,
      SUM(CASE WHEN c.embedding IS NOT NULL THEN 1 ELSE 0 END) AS indexedCount,
      MIN(c.embeddingKey) AS embeddingKey FROM documents d LEFT JOIN chunks c ON c.documentId=d.id
      GROUP BY d.id ORDER BY d.createdAt DESC`).all() as KnowledgeDocument[];
  }

  getDocument(id: string): (KnowledgeDocument & { chunks: Chunk[] }) | null {
    const document = this.listDocuments().find(d => d.id === id);
    return document ? { ...document, chunks: this.getChunks([id]) } : null;
  }

  importDocument(input: DocumentInput): { document: KnowledgeDocument; duplicate: boolean } {
    if (!input.pages.some(p => p.text.trim())) throw new Error("未提取到文字，请使用含文字层PDF、TXT或直接粘贴正文。");
    const hash = createHash("sha256").update(JSON.stringify({ pages: input.pages, sourceUrl: input.sourceUrl.trim(), kind: input.kind, year: input.year, stage: input.stage, competition: input.competition })).digest("hex");
    const existing = this.db.prepare("SELECT id FROM documents WHERE hash=?").get(hash) as { id: string } | undefined;
    if (existing) return { document: this.listDocuments().find(d => d.id === existing.id)!, duplicate: true };
    const id = randomUUID();
    const drafts = splitPages(input.pages);
    if (!drafts.length) throw new Error("文档正文为空，无法建立索引。");
    const createdAt = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO documents VALUES (@id,@hash,@title,@sourceUrl,@kind,@year,@stage,@competition,@fileName,@createdAt,@pageCount,@characterCount)`).run({
        id, hash, title: input.title, sourceUrl: input.sourceUrl, kind: input.kind,
        year: input.year, stage: input.stage, competition: input.competition, fileName: input.fileName,
        createdAt, pageCount: input.pages.filter(p => p.page !== null).length,
        characterCount: input.pages.reduce((sum, p) => sum + p.text.length, 0),
      });
      const insert = this.db.prepare("INSERT INTO chunks (id,documentId,sequence,page,paragraph,text) VALUES (?,?,?,?,?,?)");
      drafts.forEach((draft, sequence) => insert.run(randomUUID(), id, sequence, draft.page, draft.paragraph, draft.text));
    })();
    return { document: this.listDocuments().find(d => d.id === id)!, duplicate: false };
  }

  getChunks(documentIds: string[] = []): Chunk[] {
    const scope = documentIds.length ? `WHERE c.documentId IN (${documentIds.map(() => "?").join(",")})` : "";
    const rows = this.db.prepare(`SELECT c.*, d.title FROM chunks c JOIN documents d ON d.id=c.documentId ${scope} ORDER BY d.createdAt DESC,c.sequence`).all(...documentIds) as (Omit<Chunk, "embedding"> & { embedding: string | null })[];
    return rows.map(row => ({ ...row, embedding: row.embedding ? JSON.parse(row.embedding) as number[] : null }));
  }

  replaceEmbeddings(documentId: string, vectors: number[][], embeddingKey: string) {
    const chunks = this.getChunks([documentId]);
    if (!chunks.length || vectors.length !== chunks.length) throw new Error("向量数量与片段数量不一致，原索引已保留。");
    const dimension = vectors[0]?.length;
    if (!dimension || vectors.some(v => v.length !== dimension || v.some(n => !Number.isFinite(n)) || !v.some(n => n !== 0))) throw new Error("向量维度或数据无效，原索引已保留。");
    this.db.transaction(() => {
      const update = this.db.prepare("UPDATE chunks SET embedding=?,embeddingKey=? WHERE id=? AND documentId=?");
      chunks.forEach((chunk, i) => update.run(JSON.stringify(vectors[i]), embeddingKey, chunk.id, documentId));
    })();
  }

  deleteDocument(id: string) {
    this.db.transaction(() => {
      this.competitions.invalidateDocument(id);
      this.db.prepare("DELETE FROM documents WHERE id=?").run(id);
      // 历史记录包含原文快照；删除来源时同时移除引用该来源的记录。
      const answers = this.db.prepare("SELECT id,body FROM answers").all() as { id: string; body: string }[];
      for (const row of answers) {
        const answer = JSON.parse(row.body) as Answer;
        if (answer.citations.some(c => c.documentId === id)) this.db.prepare("DELETE FROM answers WHERE id=?").run(row.id);
      }
    })();
  }

  saveAnswer(answer: Answer, sessionId?: string, documentIds: string[] = []) {
    this.db.transaction(() => {
      if (sessionId && !this.getChat(sessionId)) throw new Error("聊天不存在，请重新选择。");
      const exists = this.db.prepare("SELECT 1 FROM chunks c JOIN documents d ON d.id=c.documentId WHERE c.id=? AND c.documentId=?");
      if (answer.citations.some(c => !exists.get(c.id, c.documentId))) throw new StaleCitationError();
      this.db.prepare("INSERT INTO answers VALUES (?,?,?)").run(answer.id, JSON.stringify(answer), answer.createdAt);
      if (sessionId) {
        const first = !this.db.prepare("SELECT 1 FROM chat_answers WHERE sessionId=? LIMIT 1").get(sessionId);
        const sequence = (this.db.prepare("SELECT COALESCE(MAX(sequence),-1)+1 AS next FROM chat_answers WHERE sessionId=?").get(sessionId) as {next:number}).next;
        this.db.prepare("INSERT INTO chat_answers VALUES (?,?,?)").run(answer.id,sessionId,sequence);
        this.db.prepare("UPDATE chat_sessions SET title=CASE WHEN ? THEN ? ELSE title END,documentIds=?,updatedAt=? WHERE id=?")
          .run(first ? 1 : 0,answer.question.slice(0,36),JSON.stringify(documentIds),answer.createdAt,sessionId);
      }
    })();
  }
  listChats(): ChatSession[] {
    const rows = this.db.prepare(`SELECT s.*,COUNT(a.answerId) AS answerCount FROM chat_sessions s
      LEFT JOIN chat_answers a ON a.sessionId=s.id GROUP BY s.id ORDER BY s.updatedAt DESC,s.id`).all() as (Omit<ChatSession,"documentIds"> & {documentIds:string})[];
    const existing = new Set(this.listDocuments().map(doc=>doc.id));
    return rows.map(row=>({...row,documentIds:(JSON.parse(row.documentIds) as string[]).filter(id=>existing.has(id))}));
  }
  createChat(): ChatDetail {
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare("INSERT INTO chat_sessions VALUES (?,?,?,?,?)").run(id,"新聊天","[]",now,now);
    return this.getChat(id)!;
  }
  getChat(id: string): ChatDetail | null {
    const session = this.listChats().find(chat=>chat.id===id);
    if (!session) return null;
    const rows = this.db.prepare(`SELECT a.body FROM answers a JOIN chat_answers c ON c.answerId=a.id
      WHERE c.sessionId=? ORDER BY c.sequence`).all(id) as {body:string}[];
    return {session,answers:rows.map(row=>JSON.parse(row.body) as Answer)};
  }
  listAnswers(): Answer[] { return (this.db.prepare("SELECT body FROM answers ORDER BY createdAt DESC LIMIT 30").all() as { body: string }[]).map(r => JSON.parse(r.body) as Answer).reverse(); }
  close() { this.db.close(); }
}

const globalStore = globalThis as typeof globalThis & { ragStore?: KnowledgeStore; ragStorePath?: string };
export function getStore() {
  const dbPath = path.resolve(process.env.RAG_DATA_DIR || path.join(process.cwd(), "data"), "knowledge.sqlite");
  if (!globalStore.ragStore || globalStore.ragStorePath !== dbPath) {
    globalStore.ragStore?.close();
    globalStore.ragStore = new KnowledgeStore(dbPath);
    globalStore.ragStorePath = dbPath;
  }
  return globalStore.ragStore;
}
