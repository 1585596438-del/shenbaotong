import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("分块保留每页全部内容与页码", async () => {
  const { splitPages } = await import("../src/server/chunking");
  const longText = "报名条件：团队人数不得超过三人。".repeat(180);
  const chunks = splitPages([{ page: 1, text: "比赛介绍。" }, { page: 2, text: longText }]);
  assert.equal(chunks.filter(c => c.page === 2).map(c => c.text).join(""), longText);
  assert.ok(chunks.every(c => c.text.length <= 1200));
  assert.equal(chunks[0].page, 1);
});

test("中文问题召回明确相关片段，无关问题返回空结果", async () => {
  const { rankChunks } = await import("../src/server/retrieval");
  const chunks = [
    { id: "a", documentId: "d1", title: "赛事规则", text: "参赛团队人数不得超过三人，指导教师最多两名。", page: 2, paragraph: 1, embedding: null, embeddingKey: null },
    { id: "b", documentId: "d2", title: "材料", text: "比赛需要提交作品报告与视频。", page: 3, paragraph: 1, embedding: null, embeddingKey: null },
  ];
  assert.equal(rankChunks("团队人数要求", chunks)[0]?.id, "a");
  assert.deepEqual(rankChunks("学校食堂今天供应什么菜", chunks), []);
});

test("SQLite保存可恢复，重复正文不创建第二份文档，筛选不串来源", async () => {
  const { KnowledgeStore } = await import("../src/server/store");
  const root = mkdtempSync(path.join(tmpdir(), "shenbaotong-test-"));
  const dbPath = path.join(root, "knowledge.sqlite");
  let store = new KnowledgeStore(dbPath);
  try {
    const input = { title: "团队规则", sourceUrl: "https://example.edu/notice", kind: "notice" as const, year: "2026", stage: "校赛", competition: "测试赛事", fileName: "rule.txt", pages: [{ page: null, text: "团队人数最多三人。" }] };
    const first = store.importDocument(input);
    assert.equal(store.importDocument(input).duplicate, true);
    assert.equal(store.listDocuments().length, 1);
    const other = store.importDocument({ ...input, title: "其他规则", pages: [{ page: null, text: "指导教师最多两名。" }] });
    assert.ok(store.getChunks([first.document.id]).every(c => c.documentId === first.document.id));
    assert.equal(store.getChunks([other.document.id]).length, 1);
    store.close();
    store = new KnowledgeStore(dbPath);
    assert.equal(store.listDocuments().length, 2);
    assert.equal(store.getDocument(first.document.id)?.chunks[0].text, "团队人数最多三人。");
    store.deleteDocument(first.document.id);
    assert.equal(store.getChunks([first.document.id]).length, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("本地浏览器来源使用真实Host，兼容Next内部URL，拒绝外部来源", async () => {
  const { checkOrigin } = await import("../src/server/http");
  const headers = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" };
  assert.doesNotThrow(() => checkOrigin(new Request("http://localhost:3000/api/documents", { headers })));
  assert.throws(() => checkOrigin(new Request("http://localhost:3000/api/documents", { headers: { ...headers, origin: "https://external.example" } })), /本地/);
  assert.throws(() => checkOrigin(new Request("http://localhost:3000/api/documents", { headers: { ...headers, origin: "http://127.0.0.1:3001" } })), /本地/);
});

test("文本文件能解析，错误类型、空正文和伪PDF被拒绝", async () => {
  const { parseDocument } = await import("../src/server/documents");
  const bytes = new TextEncoder().encode("竞赛通知：团队最多三人。");
  assert.equal((await parseDocument(bytes, "通知.txt"))[0].page, null);
  await assert.rejects(parseDocument(bytes, "fake.pdf"), /有效PDF/);
  await assert.rejects(parseDocument(bytes, "fake.exe"), /支持/);
  await assert.rejects(parseDocument(new Uint8Array(), "empty.txt"), /为空/);
});

test("通用赛事名称词不能让虚构赛事匹配无关目录", async () => {
  const { rankChunks } = await import("../src/server/retrieval");
  const chunks = [{ id: "a", documentId: "d", title: "目录", text: "中国大学生计算机设计大赛。全国大学生数学建模竞赛。", page: 1, paragraph: 1, embedding: null, embeddingKey: null }];
  assert.deepEqual(rankChunks("中国大学生虚构不存在大赛", chunks), []);
});

test("规则正文未重复赛事名时，标题仍能支持跨赛事召回", async () => {
  const { rankChunks } = await import("../src/server/retrieval");
  const chunks = [
    { id: "ai", documentId: "ai-doc", title: "2026人工智能创意赛参赛指南", text: "本届竞赛不限专业，可单人或自由组队，人数不超过3人，允许跨学校组队。", page: null, paragraph: 1, embedding: null, embeddingKey: null },
    { id: "software", documentId: "software-doc", title: "2026中国软件杯报名说明", text: "每队4名成员，含指导教师1名，允许跨院校组队，学生总数不超过3名。", page: null, paragraph: 1, embedding: null, embeddingKey: null },
  ];
  const result = rankChunks("2026软件杯和2026人工智能创意赛都允许跨院校组队吗？两者学生人数上限相同吗？请分别回答。", chunks);
  assert.ok(result.some(c => c.id === "ai"));
  assert.ok(result.some(c => c.id === "software"));
});

test("分块边界保留整行表格，超长表格行有明确策略", async () => {
  const { splitPages } = await import("../src/server/chunking");
  const row = "| 全国计算机设计赛 | 本科生 | 3人 |";
  const text = "甲".repeat(1095) + "\n" + row;
  const chunks = splitPages([{ page: 4, text }]);
  assert.ok(chunks.some(c => c.text.includes(row)));
  assert.equal(chunks.map(c => c.text).join(""), text);
  const longRow = "| 赛事名称 | " + "要求".repeat(600) + " | 3人 |";
  assert.ok(splitPages([{ page: 4, text: longRow }]).some(c => c.text === longRow));
  assert.throws(() => splitPages([{ page: 4, text: "|" + "甲".repeat(5000) + "|" }]), /表格行/);
});
