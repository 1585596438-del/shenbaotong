import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function setup() {
  const { KnowledgeStore } = await import("../src/server/store");
  const root = mkdtempSync(path.join(tmpdir(), "shenbaotong-rag-"));
  const store = new KnowledgeStore(path.join(root, "knowledge.sqlite"));
  const first = store.importDocument({ title: "2026测试赛", sourceUrl: "https://example.edu/notice", kind: "notice", year: "2026", stage: "校赛", competition: "测试赛", fileName: "notice.txt", pages: [{ page: 2, text: "参赛团队人数最多三人。作品提交截止日期为2026年11月7日，未写明具体时刻。" }] });
  return { store, first, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("没有API配置只返回原文证据，明确标记原文检索", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const response = await answerQuestion({ question: "团队人数要求", documentIds: [env.first.document.id] }, env.store, null);
    assert.equal(response.mode, "extractive");
    assert.ok(response.citations[0].text.includes("最多三人"));
    assert.equal(response.citations[0].page, 2);
    assert.ok(response.warnings.length > 0);
  } finally { env.close(); }
});

test("无依据问题不生成答案，也不引用无关文档", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const other = env.store.importDocument({ title: "其他赛事", sourceUrl: "", kind: "notice", year: "2025", stage: "国赛", competition: "其他赛事", fileName: "other.txt", pages: [{ page: null, text: "学校食堂供应白菜。" }] });
    const result = await answerQuestion({ question: "学校食堂供应什么菜", documentIds: [env.first.document.id] }, env.store, null);
    assert.equal(result.mode, "no_evidence");
    assert.equal(result.citations.length, 0);
    assert.ok(!result.citations.some(c => c.documentId === other.document.id));
  } finally { env.close(); }
});

test("模型回答只能引用本次提供的片段", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    let calls = 0;
    const provider = {
      embeddingReady: false, chatReady: true, embeddingKey: "none",
      async embed() { return []; },
      async generate() { calls++; return JSON.stringify({ hasEvidence: true, answer: "不限人数，可以直接报名。", citations: ["invented-id"] }); },
    };
    const result = await answerQuestion({ question: "团队人数要求", documentIds: [env.first.document.id] }, env.store, provider);
    assert.equal(result.mode, "extractive");
    assert.ok(!result.answer.includes("不限人数"));
    assert.ok(result.citations.every(c => c.documentId === env.first.document.id));
    assert.equal(calls, 2);
  } finally { env.close(); }
});

test("合法模型回答附真实引用，API失败仍保留正文", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const chunk = env.store.getChunks([env.first.document.id])[0];
    const provider = {
      embeddingReady: false, chatReady: true, embeddingKey: "none",
      async embed() { return []; },
      async generate() { return JSON.stringify({ hasEvidence: true, answer: "团队最多三人，详见引用。", citations: [chunk.id] }); },
    };
    const result = await answerQuestion({ question: "团队人数", documentIds: [env.first.document.id] }, env.store, provider);
    assert.equal(result.mode, "generated");
    assert.equal(result.citations[0].id, chunk.id);
    provider.generate = async () => { throw new Error("API unavailable"); };
    const fallback = await answerQuestion({ question: "团队人数", documentIds: [env.first.document.id] }, env.store, provider);
    assert.equal(fallback.mode, "extractive");
    assert.equal(env.store.listDocuments().length, 1);
  } finally { env.close(); }
});

test("余弦检索拒绝维度不一致或非有限向量", async () => {
  const { cosineSimilarity } = await import("../src/server/retrieval");
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [1]), 0);
  assert.equal(cosineSimilarity([Number.NaN], [1]), 0);
});

test("索引失败与无效零向量不能覆盖已有索引", async () => {
  const { indexDocument } = await import("../src/server/rag");
  const env = await setup();
  try {
    const id = env.first.document.id;
    env.store.replaceEmbeddings(id, [[1, 0]], "old-model");
    const provider = { chatReady: false, embeddingReady: true, embeddingKey: "new-model", async embed() { return [[0, 0]]; }, async generate() { return ""; } };
    await assert.rejects(indexDocument(id, env.store, provider), /无效|保留/);
    assert.equal(env.store.getChunks([id])[0].embeddingKey, "old-model");
    provider.embed = async () => { throw new Error("service offline"); };
    await assert.rejects(indexDocument(id, env.store, provider), /offline/);
    assert.deepEqual(env.store.getChunks([id])[0].embedding, [1, 0]);
  } finally { env.close(); }
});

test("兼容接口按索引还原向量顺序，不接受错误索引或泄露认证响应", async () => {
  const { createServer } = await import("node:http");
  const { ApiProvider } = await import("../src/server/provider");
  let bad = false;
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString());
    assert.equal(req.headers.authorization, "Bearer test-secret");
    if (req.url === "/v1/embeddings") res.end(JSON.stringify({ data: bad ? [{ index: 3, embedding: [1, 0] }, { index: 3, embedding: [0, 1] }] : body.input.map((_: string, index: number) => ({ index, embedding: index ? [0, 1] : [1, 0] })).reverse() }));
    else { res.statusCode = 401; res.end("secret provider response test-secret"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const provider = new ApiProvider({ baseUrl, apiKey: "test-secret", chatModel: "fixture", embeddingBaseUrl: baseUrl, embeddingApiKey: "test-secret", embeddingModel: "fixture-vector" });
  try {
    assert.deepEqual(await provider.embed(["甲", "乙"]), [[1, 0], [0, 1]]);
    bad = true;
    await assert.rejects(provider.embed(["甲", "乙"]), /索引/);
    await assert.rejects(provider.generate("system", "user"), error => error instanceof Error && error.message.includes("HTTP 401") && !error.message.includes("test-secret"));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("模型更换后不使用旧向量，未知文档范围直接拒绝", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    env.store.replaceEmbeddings(env.first.document.id, [[1, 0]], "old-model");
    let calls = 0;
    const provider = { chatReady: false, embeddingReady: true, embeddingKey: "new-model", async embed() { calls++; return [[1, 0]]; }, async generate() { return ""; } };
    const answer = await answerQuestion({ question: "团队人数" }, env.store, provider);
    assert.equal(answer.retrievalMode, "keyword");
    assert.equal(calls, 0);
    await assert.rejects(answerQuestion({ question: "团队人数", documentIds: ["deleted"] }, env.store, provider), /不存在/);
  } finally { env.close(); }
});

test("缺少明确证据标志的模型响应不能展示为引用问答", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const chunk = env.store.getChunks([env.first.document.id])[0];
    const provider = { chatReady: true, embeddingReady: false, embeddingKey: "none", async embed() { return []; }, async generate() { return JSON.stringify({ answer: "模型结论", citations: [chunk.id] }); } };
    const answer = await answerQuestion({ question: "团队人数" }, env.store, provider);
    assert.equal(answer.mode, "extractive");
    assert.ok(!answer.answer.includes("模型结论"));
  } finally { env.close(); }
});

test("索引后可做混合检索，模型收到年度与阶段，答案只含实际引用", async () => {
  const { indexDocument, answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const provider = { chatReady: true, embeddingReady: true, embeddingKey: "fixture", async embed(texts: string[]) { return texts.map(() => [1, 0]); }, async generate(_system: string, user: string) {
      const input = JSON.parse(user);
      assert.equal(input.passages[0].year, "2026"); assert.equal(input.passages[0].stage, "校赛");
      return JSON.stringify({ hasEvidence: true, answer: "2026校赛团队最多三人。", citations: [input.passages[0].id] });
    } };
    await indexDocument(env.first.document.id, env.store, provider);
    const answer = await answerQuestion({ question: "团队人数", documentIds: [env.first.document.id] }, env.store, provider);
    assert.equal(answer.mode, "generated"); assert.equal(answer.retrievalMode, "hybrid");
    assert.equal(answer.citations[0].page, 2);
  } finally { env.close(); }
});

test("生成等待期间删除来源不能返回或持久化失效引用", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const chunk = env.store.getChunks([env.first.document.id])[0];
    const provider = { chatReady: true, embeddingReady: false, embeddingKey: "none", async embed() { return []; }, async generate() {
      env.store.deleteDocument(env.first.document.id);
      return JSON.stringify({ hasEvidence: true, answer: "团队最多三人", citations: [chunk.id] });
    } };
    const answer = await answerQuestion({ question: "团队人数" }, env.store, provider);
    assert.equal(answer.mode, "no_evidence"); assert.deepEqual(answer.citations, []);
    assert.ok(answer.warnings.some(w => w.includes("删除")));
    assert.ok(env.store.listAnswers().every(a => a.citations.length === 0));
  } finally { env.close(); }
});

test("查询嵌入等待期间删除来源不能重新保存原文快照", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    env.store.replaceEmbeddings(env.first.document.id, [[1, 0]], "fixture");
    const provider = { chatReady: false, embeddingReady: true, embeddingKey: "fixture", async embed() {
      env.store.deleteDocument(env.first.document.id); return [[1, 0]];
    }, async generate() { return ""; } };
    const answer = await answerQuestion({ question: "团队人数" }, env.store, provider);
    assert.equal(answer.mode, "no_evidence"); assert.deepEqual(answer.citations, []);
    assert.ok(env.store.listAnswers().every(a => a.citations.length === 0));
  } finally { env.close(); }
});
