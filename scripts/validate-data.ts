import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Answer, KnowledgeDocument } from "../src/server/types";

const [catalogPath, policyPath] = process.argv.slice(2);
if (!catalogPath || !policyPath) throw new Error('用法：npm run validate:data -- "竞赛目录PDF路径" "学校管理办法PDF路径"');
const base = process.env.VALIDATE_BASE_URL || "http://127.0.0.1:3000";
const checks: { name: string; passed: boolean; detail: unknown }[] = [];
async function request<T>(route: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${route}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: ${data.error}`);
  return data as T;
}
async function upload(filePath: string, kind: string, year: string) {
  const form = new FormData();
  form.set("title", path.basename(filePath, ".pdf")); form.set("kind", kind); form.set("year", year);
  form.set("file", new File([await readFile(filePath)], path.basename(filePath), { type: "application/pdf" }));
  return request<{ document: KnowledgeDocument; duplicate: boolean }>("/api/documents", { method: "POST", body: form });
}
async function ask(question: string, documentIds: string[]) {
  return (await request<{ answer: Answer }>("/api/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, documentIds }) })).answer;
}
function record(name: string, detail: unknown) { checks.push({ name, passed: true, detail }); console.log(`PASS ${name}`); }

async function main() {
const catalog = await upload(catalogPath, "catalog", "2024");
const policy = await upload(policyPath, "policy", "2023");
assert.equal(catalog.document.pageCount, 8); assert.equal(policy.document.pageCount, 20);
record("两份真实PDF经导入接口解析，保留8页与20页", [catalog.document, policy.document]);
for (const [name, question, docId, expected] of [
  ["目录计算机赛事", "中国大学生计算机设计大赛", catalog.document.id, "中国大学生计算机设计大赛"],
  ["目录末页不丢失", "码蹄杯全国职业院校程序设计大赛", catalog.document.id, "码蹄"],
  ["学校B类认定", "B类竞赛如何认定", policy.document.id, "B"],
  ["省分赛分类原文", "B类竞赛项目的省分赛或分区赛", policy.document.id, "分"],
] as const) {
  const answer = await ask(question, [docId]);
  assert.notEqual(answer.mode, "no_evidence", `${name}未召回`);
  assert.ok(answer.citations.length && answer.citations.every(c => c.documentId === docId));
  assert.ok(answer.citations.some(c => c.text.replace(/\s/g, "").includes(expected)));
  if (name === "目录末页不丢失") assert.ok(answer.citations.some(c => c.page === 8));
  record(name, { question, mode: answer.mode, pages: answer.citations.map(c => c.page), citations: answer.citations });
}
const unknown = await ask("学校食堂今天供应什么菜", [catalog.document.id, policy.document.id]);
assert.equal(unknown.mode, "no_evidence"); assert.deepEqual(unknown.citations, []);
record("无依据问题不借用无关片段作答", { question: unknown.question, mode: unknown.mode });
const scoped = await ask("中国大学生计算机设计大赛", [policy.document.id]);
assert.ok(scoped.citations.every(c => c.documentId === policy.document.id));
record("限定文档时不能引用目录", { mode: scoped.mode, pages: scoped.citations.map(c => c.page) });
assert.equal((await upload(catalogPath, "catalog", "2024")).duplicate, true);
assert.equal((await upload(policyPath, "policy", "2023")).duplicate, true);
record("重复导入不新增文档", "两份附件再次上传均返回duplicate:true");

const invalid = await fetch(`${base}/api/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "人数", documentIds: ["missing-document"] }) });
assert.equal(invalid.status, 400); record("无效文档范围被拒绝", 400);
const foreign = await fetch(`${base}/api/questions`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, body: JSON.stringify({ question: "人数" }) });
assert.equal(foreign.status, 400); record("浏览器跨站写入被拒绝", 400);
const status = await request<{ documents: KnowledgeDocument[]; model: { chatReady: boolean; embeddingReady: boolean } }>("/api/status");
if (!status.model.embeddingReady) {
  const index = await fetch(`${base}/api/documents/${catalog.document.id}/index`, { method: "POST" });
  assert.equal(index.status, 400);
  assert.ok((await request<{ documents: KnowledgeDocument[] }>("/api/documents")).documents.some(d => d.id === catalog.document.id));
  record("未配置嵌入模型时索引失败不删除正文", 400);
}
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/data-validation.json", JSON.stringify({ time: new Date().toISOString(), model: status.model, documents: status.documents, checks }, null, 2));
console.log(`完成 ${checks.length} 项真实资料验证。结果：artifacts/data-validation.json`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
