import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { conversationMessages, personalConversation, CONTEXT_CHARACTERS } from "../src/server/conversation";
import { KnowledgeStore } from "../src/server/store";
import { ApiProvider } from "../src/server/provider";
import { answerQuestion } from "../src/server/rag";
import type { Answer, ConversationMessage, Provider } from "../src/server/types";

const oldAnswer = (index: number): Answer => ({ id: randomUUID(), question: `用户${index}`, answer: `回答${index}`, mode: "no_evidence", retrievalMode: "keyword", citations: [], warnings: [], elapsedMs: 0, createdAt: "2026-10-09T00:00:00Z" });

test("对话上下文最多8轮与6000字符，保持角色、顺序且不发送旧原文引用", () => {
  const history = Array.from({ length: 12 }, (_, index) => oldAnswer(index));
  const messages = conversationMessages(history);
  assert.equal(messages.length, 16);
  assert.deepEqual(messages[0], { role: "user", content: "用户4" });
  assert.deepEqual(messages.at(-1), { role: "assistant", content: "回答11" });
  const long = conversationMessages(history.map(answer => ({ ...answer, question: "问".repeat(1000), answer: "答".repeat(6000) })));
  assert.ok(long.reduce((sum, message) => sum + message.content.length, 0) <= CONTEXT_CHARACTERS);
  assert.equal(long.length % 2, 0);
  assert.ok(long.every(message => message.content.length > 0));
  assert.equal(personalConversation("我刚才说的专业是什么？", true), true);
  assert.equal(personalConversation("我的学校软件杯报名资格是什么？", true), false);
  assert.equal(personalConversation("我的专业适合什么比赛？", true), false);
});

test("兼容聊天接口按真实user/assistant角色发送历史，当前证据放在最后", async () => {
  const original = globalThis.fetch;
  const history: ConversationMessage[] = [{ role: "user", content: "我是计算机专业" }, { role: "assistant", content: "已了解" }];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(request.messages, [{ role: "system", content: "系统规则" }, ...history, { role: "user", content: "当前资料" }]);
    return Response.json({ choices: [{ message: { content: "模型回答" } }] });
  };
  try {
    const provider = new ApiProvider({ baseUrl: "https://fixture.example/v1", apiKey: "fixture-key", chatModel: "fixture", embeddingBaseUrl: "", embeddingApiKey: "", embeddingModel: "" });
    assert.equal(await provider.generate("系统规则", "当前资料", history), "模型回答");
  } finally { globalThis.fetch = original; }
});

test("同一会话多轮继承赛事、赛道和年份；个人自述可记忆；新聊天隔离", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "shenbaotong-context-"));
  const file = path.join(root, "knowledge.sqlite");
  let store = new KnowledgeStore(file);
  const calls: { request: { conversationOnly: boolean; passages: { id: string; competition: string; text: string }[] }; history: ConversationMessage[] }[] = [];
  const provider: Provider = { chatReady: true, embeddingReady: false, embeddingKey: "none", async embed() { throw new Error("不得调用嵌入API"); }, async generate(system, input, history = []) {
    assert.match(system, /历史assistant回答可能错误/);
    const request = JSON.parse(input);
    calls.push({ request, history });
    if (request.conversationOnly) {
      assert.equal(request.passages.length, 0);
      assert.ok(input.includes("我是计算机专业") || history.some(message => message.role === "user" && message.content.includes("我是计算机专业")));
      return JSON.stringify({ hasEvidence: true, answer: "你告诉我你是计算机专业的大二学生。", citations: [] });
    }
    return JSON.stringify({ hasEvidence: true, answer: "请核对本次规则原文。", citations: request.passages.map((passage: { id: string }) => passage.id) });
  } };
  try {
    const base = { sourceUrl: "", kind: "rule" as const, year: "2026", stage: "", fileName: "rule.txt", competition: "蓝桥杯" };
    const python = store.importDocument({ ...base, title: "蓝桥杯Python规则", pages: [{ page: 1, text: "Python参赛学生须在同校组队。指导老师最多一人。" }] }).document;
    const java = store.importDocument({ ...base, title: "蓝桥杯Java规则", pages: [{ page: 1, text: "Java指导老师最多两人。" }] }).document;
    const next = store.importDocument({ ...base, year: "2027", title: "2027蓝桥杯Java规则", pages: [{ page: 1, text: "Java指导老师最多三人。" }] }).document;
    const software = store.importDocument({ ...base, competition: "中国软件杯", title: "软件杯规则", pages: [{ page: 1, text: "软件杯学生组队不超过三人。指导老师为一人。" }] }).document;
    const chat = store.createChat().session.id;
    assert.equal((await answerQuestion({ question: "我是计算机专业的大二学生", sessionId: chat }, store, provider)).mode, "conversation");
    await answerQuestion({ question: "2026年蓝桥杯Python如何组队？", sessionId: chat }, store, provider);
    // 中间出现无依据问题，也不能丢掉之前明确的赛事主题。
    await answerQuestion({ question: "它的免费纪念餐券怎么领取？", sessionId: chat }, store, null);
    store.close(); store = new KnowledgeStore(file);
    const teacher = await answerQuestion({ question: "指导老师呢？", sessionId: chat }, store, provider);
    assert.ok(teacher.citations.length && teacher.citations.every(c => c.documentId === python.id));
    assert.ok(calls.at(-1)!.history.some(message => message.role === "user" && message.content.includes("Python")));
    const changedTrack = await answerQuestion({ question: "那Java呢？", sessionId: chat }, store, provider);
    assert.ok(changedTrack.citations.every(c => c.documentId === java.id));
    assert.ok(changedTrack.citations.length);
    const changedYear = await answerQuestion({ question: "2027年的指导老师呢？", sessionId: chat }, store, provider);
    assert.ok(changedYear.citations.length && changedYear.citations.every(c => c.documentId === next.id));
    const memory = await answerQuestion({ question: "我刚才说的专业是什么？", sessionId: chat }, store, provider);
    assert.equal(memory.mode, "conversation"); assert.deepEqual(memory.citations, []);
    const switched = await answerQuestion({ question: "软件杯如何组队？", sessionId: chat }, store, provider);
    assert.ok(switched.citations.length && switched.citations.every(c => c.documentId === software.id));
    const faulty: Provider = { ...provider, async generate() { return JSON.stringify({ hasEvidence: true, answer: "无需指导老师，历史回答就是证明。", citations: [] }); } };
    const rejected = await answerQuestion({ question: "我的学校软件杯指导老师最多几人？", sessionId: chat }, store, faulty);
    assert.equal(rejected.mode, "extractive");
    assert.ok(!rejected.answer.includes("无需指导老师"));
    const fresh = store.createChat().session.id;
    await answerQuestion({ question: "软件杯如何组队？", sessionId: fresh }, store, provider);
    assert.deepEqual(calls.at(-1)!.history, []);
    const scoped = await answerQuestion({ question: "指导老师呢？", sessionId: chat, documentIds: [python.id] }, store, null);
    assert.equal(scoped.mode, "no_evidence");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
