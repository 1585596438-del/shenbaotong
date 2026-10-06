export type DocumentKind = "catalog" | "policy" | "notice" | "rule";
export type PageText = { page: number | null; text: string };
export type ChunkDraft = PageText & { paragraph: number };
export type DocumentInput = {
  title: string; sourceUrl: string; kind: DocumentKind; year: string;
  stage: string; competition: string; fileName: string; pages: PageText[];
};
export type KnowledgeDocument = Omit<DocumentInput, "pages"> & {
  id: string; createdAt: string; pageCount: number; chunkCount: number;
  characterCount: number; indexedCount: number; embeddingKey: string | null;
};
export type Chunk = ChunkDraft & {
  id: string; documentId: string; title: string;
  embedding: number[] | null; embeddingKey: string | null;
};
export type RankedChunk = Chunk & { score: number; lexicalScore: number; vectorScore: number };
export type Citation = {
  id: string; documentId: string; title: string; text: string;
  page: number | null; paragraph: number; sourceUrl: string;
};
export type Answer = {
  id: string; question: string; answer: string;
  retrievalQuestion?: string;
  mode: "generated" | "extractive" | "no_evidence";
  retrievalMode: "hybrid" | "keyword"; citations: Citation[];
  warnings: string[]; elapsedMs: number; createdAt: string;
};
export type ChatSession = { id: string; title: string; documentIds: string[]; createdAt: string; updatedAt: string; answerCount: number };
export type ChatDetail = { session: ChatSession; answers: Answer[] };
export interface Provider {
  chatReady: boolean; embeddingReady: boolean; embeddingKey: string;
  embed(texts: string[]): Promise<number[][]>;
  generate(system: string, user: string): Promise<string>;
}
