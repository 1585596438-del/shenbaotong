import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { localModelReady } from "../src/server/local-embeddings";
import { LOCAL_EMBEDDING_MODEL } from "../src/server/embedding-config";
import { ApiProvider } from "../src/server/provider";
import { KnowledgeStore } from "../src/server/store";
import { answerQuestion, indexDocument } from "../src/server/rag";

test("本机模型离线生成真实中文向量，索引后按语义召回并使用混合检索", { skip: !localModelReady() && "先下载本机模型后运行此集成测试" }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "shenbaotong-local-vectors-"));
  const store = new KnowledgeStore(path.join(root, "knowledge.sqlite"));
  const provider = new ApiProvider({ baseUrl: "", apiKey: "", chatModel: "", embeddingBaseUrl: "", embeddingApiKey: "", embeddingModel: LOCAL_EMBEDDING_MODEL });
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("本机嵌入不得发送网络请求"); };
  try {
    const relevant = "允许跨院校组队，每队最多三名学生。";
    const unrelated = "今天天气晴朗，可以去公园散步。";
    const query = "可以和其他学校的同学一起参赛吗？";
    const [good, bad] = await provider.embed([relevant, unrelated]);
    const vector = await provider.embedQuery(query);
    const cosine = (left: number[], right: number[]) => left.reduce((sum, value, i) => sum + value * right[i], 0);
    assert.equal(vector.length, 512);
    assert.ok(Math.abs(Math.hypot(...good) - 1) < 1e-5);
    assert.ok(cosine(vector, good) > cosine(vector, bad));
    const document = store.importDocument({ title: "组队资格说明", sourceUrl: "", kind: "rule", year: "2026", stage: "", competition: "测试赛", fileName: "rule.txt", pages: [{ page: 1, text: relevant }] }).document;
    await indexDocument(document.id, store, provider);
    const indexed = store.getDocument(document.id)!;
    assert.equal(indexed.indexedCount, indexed.chunkCount);
    assert.equal(indexed.embeddingKey, provider.embeddingKey);
    const answer = await answerQuestion({ question: query }, store, provider);
    assert.equal(answer.retrievalMode, "hybrid");
    assert.ok(answer.citations.some(c => c.documentId === document.id));
    assert.ok(answer.warnings.every(w => !w.includes("未使用向量检索")));
    const outside = await answerQuestion({ question: "明天降雨概率多少？" }, store, provider);
    assert.equal(outside.mode, "no_evidence");
    assert.deepEqual(outside.citations, []);
  } finally { globalThis.fetch = fetchBefore; store.close(); rmSync(root, { recursive: true, force: true }); }
});
