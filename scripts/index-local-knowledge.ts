import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { ApiProvider, readProviderConfig } from "../src/server/provider";
import { LOCAL_EMBEDDING_MODEL } from "../src/server/embedding-config";
import { getStore } from "../src/server/store";
import { indexDocument } from "../src/server/rag";

async function main() {
  if (readProviderConfig().embeddingModel !== LOCAL_EMBEDDING_MODEL) throw new Error("请先在运行设置选择并保存本机免费嵌入模型；此命令不会调用付费嵌入 API。");
  const provider = new ApiProvider();
  if (!provider.embeddingReady) throw new Error("本机模型尚未下载，请先运行 npm run setup:embeddings。");
  const root = path.resolve(process.env.RAG_DATA_DIR || "data");
  await mkdir(path.join(root, "backups"), { recursive: true });
  const database = path.join(root, "knowledge.sqlite");
  if (existsSync(database)) {
    const source = new Database(database, { readonly: true, fileMustExist: true });
    try { await source.backup(path.join(root, "backups", `before-local-index-${Date.now()}.sqlite`)); }
    finally { source.close(); }
  }
  const store = getStore();
  try {
    const documents = store.listDocuments();
    let indexed = 0, skipped = 0;
    for (const [position, document] of documents.entries()) {
      if (document.chunkCount > 0 && document.indexedCount === document.chunkCount && document.embeddingKey === provider.embeddingKey) { skipped++; continue; }
      await indexDocument(document.id, store, provider);
      indexed++;
      console.log(`[${position + 1}/${documents.length}] ${document.title} · ${document.chunkCount} 个向量片段`);
    }
    const report = { completedAt: new Date().toISOString(), indexed, skipped, documents: store.listDocuments().map(doc => ({ id: doc.id, title: doc.title, chunks: doc.chunkCount, indexed: doc.indexedCount, embeddingKey: doc.embeddingKey })) };
    await writeFile(path.join(root, "local-index-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ indexed, skipped, total: documents.length }));
  } finally { store.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "本机索引失败。"); process.exitCode = 1; });
