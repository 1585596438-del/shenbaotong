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

test("学校类别认定只查政策和目录，不把比赛内部赛道分类当学校认定", async () => {
  const env = await setup();
  try {
    const policy = env.store.importDocument({ title: "学校竞赛管理办法", kind: "policy", competition: "", sourceUrl: "", year: "2023", stage: "", fileName: "policy.txt", pages: [{ page: 1, text: "学校竞赛类别认定由教务部门按照竞赛管理办法审核。学分奖励须办理校内认定。" }] }).document;
    env.store.importDocument({ title: "农业比赛规则", kind: "rule", competition: "农业比赛", sourceUrl: "", year: "2026", stage: "全国", fileName: "rule.txt", pages: [{ page: 1, text: "竞赛类别为A类、B类、C类、D类，按作品赛道分类。" }] });
    const { answerQuestion } = await import("../src/server/rag");
    const answer = await answerQuestion({ question: "学校竞赛类别如何认定？" }, env.store, null);
    assert.ok(answer.citations.length);
    assert.ok(answer.citations.every(c => c.documentId === policy.id));
  } finally { env.close(); }
});

test("ISCC简称与赛区共同限定来源，不混用河南和上海报名截止", async () => {
  const env = await setup();
  try {
    const base = { kind: "notice" as const, competition: "全国大学生信息安全与对抗技术竞赛", sourceUrl: "", year: "2026", fileName: "notice.pdf" };
    const shanghai = env.store.importDocument({ ...base, title: "2026 ISCC上海区域赛通知", stage: "上海区域赛", pages: [{ page: 2, text: "上海区域赛报名截止时间为2026年05月06日20:00。" }] }).document;
    env.store.importDocument({ ...base, title: "2026 ISCC河南区域赛通知", stage: "河南区域赛", pages: [{ page: 2, text: "河南区域赛报名截止时间为2026年04月30日20:00。" }] });
    const { answerQuestion } = await import("../src/server/rag");
    const answer = await answerQuestion({ question: "2026年ISCC上海赛区报名什么时候截止？" }, env.store, null);
    assert.ok(answer.citations.length);
    assert.ok(answer.citations.every(c => c.documentId === shanghai.id));
  } finally { env.close(); }
});

test("软件杯提交日程优先取对应延期通知，保留原通知用于资格查询", async () => {
  const env = await setup();
  try {
    const base = { kind: "notice" as const, competition: "中国软件杯大学生软件设计大赛", sourceUrl: "", year: "2026（第15届）", fileName: "notice.txt" };
    const old = env.store.importDocument({ ...base, title: "软件杯原始举办通知", stage: "原始通知（时间须结合延期通知）", pages: [{ page: null, text: "软件杯作品提交截止日期为2026年6月30日。参赛团队必须由在校学生组成。" }] }).document;
    const update = env.store.importDocument({ ...base, title: "软件杯延期与作品提交截止通知", stage: "报名延期、初赛提交", pages: [{ page: null, text: "软件杯作品提交截止时间调整为2026年7月20日15:00。" }] }).document;
    const { answerQuestion } = await import("../src/server/rag");
    const schedule = await answerQuestion({ question: "软件杯作品提交截止日期是什么时候？" }, env.store, null);
    assert.equal(schedule.citations[0].documentId, update.id);
    assert.ok(schedule.citations.every(c => c.documentId !== old.id));
    const eligibility = await answerQuestion({ question: "软件杯参赛团队必须由在校学生组成吗？" }, env.store, null);
    assert.ok(eligibility.citations.some(c => c.documentId === old.id));
    const followUp = await answerQuestion({ question: "那参赛团队必须由在校学生组成吗？", previousAnswerId: schedule.id }, env.store, null);
    assert.ok(followUp.citations.some(c => c.documentId === old.id));
  } finally { env.close(); }
});

test("完整赛事名不能挤掉正文中的团队人数条款", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const name = "“工行杯”全国大学生金融科技创新大赛";
    const doc = env.store.importDocument({ title: `2026${name}规则`, sourceUrl: "https://example.edu/2026", kind: "rule", year: "2026", stage: "全国赛", competition: name, fileName: "rule.txt", pages: [{ page: null, text: Array.from({length: 12}, (_, i) => `${name}介绍${i}：创新金融科技服务。`).join("\n\n") + "\n\n参赛作品可由个人或团队完成，团队总人数不超过3人。" }] }).document;
    const answer = await answerQuestion({ question: `2026年${name}团队最多多少人？` }, env.store, null);
    assert.ok(answer.citations.some(c => c.documentId === doc.id && c.text.includes("团队总人数不超过3人")));
    assert.ok(answer.citations.every(c => c.documentId === doc.id));
  } finally { env.close(); }
});

test("口语问题锁定指定赛事，今年解析为当前年度，不混用软件杯和历史目录", async () => {
  const { planRetrieval } = await import("../src/server/query");
  const env = await setup();
  try {
    const base = {sourceUrl:"",kind:"rule" as const,year:"2026",stage:"全国",fileName:"rule.txt"};
    const design = env.store.importDocument({...base,title:"2026计算机设计大赛参赛要求",competition:"中国大学生计算机设计大赛",pages:[{page:null,text:"作品类别包括软件应用与开发、人工智能应用。"}]}).document;
    env.store.importDocument({...base,title:"软件杯",competition:"中国软件杯大学生软件设计大赛",pages:[{page:null,text:"今年比赛项目是软件设计（应用系统）。"}]});
    env.store.importDocument({...base,year:"2024",title:"2024计算机设计大赛",competition:design.competition,pages:[{page:null,text:"历史类别为旧规则。"}]});
    const plan=planRetrieval("今年中国大学生计算机设计大赛有什么比赛项目",env.store.listDocuments(),undefined,new Date("2026-10-05"));
    assert.deepEqual(plan.documents.map(d=>d.id),[design.id]);
    assert.match(plan.retrievalQuestion,/2026年/);
  } finally {env.close();}
});

test("短标题检索补齐后续真实条款，所有引用保持原来的来源与片段ID", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env=await setup();
  try {
    const doc=env.store.importDocument({title:"中国软件杯举办通知",competition:"中国软件杯大学生软件设计大赛",sourceUrl:"https://example.edu/software",kind:"notice",year:"2026",stage:"",fileName:"web.txt",pages:[{page:null,text:"比赛项目是软件设计（应用系统）。\n\n作品必须提供独立开发的原创源代码。\n\n开发说明须介绍技术路线与测试结果。\n\n提交材料为演示视频和完整开发文档。"}]}).document;
    const provider={chatReady:true,embeddingReady:false,embeddingKey:"none",async embed(){return [];},async generate(_system:string,user:string){
      const {passages}=JSON.parse(user);
      assert.ok(passages.some((p:{text:string})=>p.text.includes("原创源代码")));
      assert.ok(passages.some((p:{text:string})=>p.text.includes("技术路线")));
      assert.ok(passages.every((p:{competition:string})=>p.competition.includes("软件杯")));
      return JSON.stringify({hasEvidence:true,answer:"项目为软件设计，须提供原创源代码、技术路线和测试结果。",citations:passages.map((p:{id:string})=>p.id)});
    }};
    const answer=await answerQuestion({question:"软件杯的软件设计（应用系统）详细讲一下"},env.store,provider);
    assert.equal(answer.mode,"generated");
    assert.ok(answer.citations.every(c=>c.documentId===doc.id && c.sourceUrl===doc.sourceUrl));
  } finally {env.close();}
});

test("追问沿用用户上一问的赛事，不把上一条错误模型回答作为原文证据", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env=await setup();
  try {
    const base={sourceUrl:"",kind:"rule" as const,year:"2026",stage:"",fileName:"rule.txt"};
    const design=env.store.importDocument({...base,title:"计算机设计大赛",competition:"中国大学生计算机设计大赛",pages:[{page:null,text:"软件应用与开发包括Web应用、管理信息系统和移动应用。"}]}).document;
    const software=env.store.importDocument({...base,title:"软件杯举办通知",competition:"中国软件杯大学生软件设计大赛",pages:[{page:null,text:"比赛项目是软件设计（应用系统）。"}]}).document;
    const old=await answerQuestion({question:"2026中国大学生计算机设计大赛有什么比赛项目"},env.store,null);
    const provider={chatReady:true,embeddingReady:false,embeddingKey:"none",async embed(){return [];},async generate(_system:string,user:string){
      const input=JSON.parse(user);
      assert.match(input.previousQuestion,/计算机设计大赛/);
      assert.ok(input.passages.every((p:{competition:string})=>p.competition.includes("计算机设计大赛")));
      return JSON.stringify({hasEvidence:true,answer:"该赛事实际类别叫软件应用与开发，包括Web应用、管理信息系统和移动应用。",citations:input.passages.map((p:{id:string})=>p.id)});
    }};
    const detail=await answerQuestion({question:"软件设计(应用系统)。详细讲一下",previousAnswerId:old.id},env.store,provider);
    assert.equal(detail.mode,"generated"); assert.ok(detail.citations.every(c=>c.documentId===design.id));
    const continued=await answerQuestion({question:"还有哪些具体要求",previousAnswerId:detail.id},env.store,null);
    assert.match(continued.retrievalQuestion!,/计算机设计大赛/);
    assert.ok(continued.citations.length && continued.citations.every(c=>c.documentId===design.id));
    const switched=await answerQuestion({question:"软件杯有什么比赛项目",previousAnswerId:old.id},env.store,null);
    assert.ok(switched.citations.length && switched.citations.every(c=>c.documentId===software.id));
    const another=env.store.importDocument({...base,title:"新导入赛事",competition:"校园开源挑战赛",pages:[{page:null,text:"开源软件作品需附源代码和文档。"}]}).document;
    const imported=await answerQuestion({question:"校园开源挑战赛的开源软件作品详细讲一下",previousAnswerId:old.id},env.store,null);
    assert.ok(imported.citations.length && imported.citations.every(c=>c.documentId===another.id));
    const outsideScope=await answerQuestion({question:"详细讲一下",previousAnswerId:old.id,documentIds:[software.id]},env.store,null);
    assert.equal(outsideScope.mode,"no_evidence");
  } finally {env.close();}
});

test("跨赛事比较保留双方，蓝桥杯指定Python时不混入Java规则", async () => {
  const { planRetrieval }=await import("../src/server/query");
  const env=await setup();
  try {
    const base={sourceUrl:"",kind:"rule" as const,year:"2026",stage:"",fileName:"rule.txt",pages:[{page:null,text:"规则正文。"}]};
    const software=env.store.importDocument({...base,title:"软件杯",competition:"中国软件杯大学生软件设计大赛"}).document;
    const ai=env.store.importDocument({...base,title:"人工智能创意赛",competition:"中国高校计算机大赛／人工智能创意赛"}).document;
    const python=env.store.importDocument({...base,title:"蓝桥杯Python",competition:"蓝桥杯／Python"}).document;
    env.store.importDocument({...base,title:"蓝桥杯Java",competition:"蓝桥杯／Java"});
    assert.deepEqual(new Set(planRetrieval("软件杯和人工智能创意赛学生人数相同吗",env.store.listDocuments()).documents.map(d=>d.id)),new Set([software.id,ai.id]));
    assert.deepEqual(planRetrieval("蓝桥杯Python考什么",env.store.listDocuments()).documents.map(d=>d.id),[python.id]);
  } finally {env.close();}
});

test("真实引用中的同校限制不能被模型改为允许跨校", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const doc=env.store.importDocument({title:"校际规则",sourceUrl:"https://example.edu/team",kind:"rule",year:"2026",stage:"全国",competition:"校际规则",fileName:"rule.txt",pages:[{page:null,text:"团队由3名学生和1名指导教师组成，学生及指导教师需来自同一所高校。"}]}).document;
    const chunk=env.store.getChunks([doc.id])[0];
    const provider={chatReady:true,embeddingReady:false,embeddingKey:"none",async embed(){return [];},async generate(){return JSON.stringify({hasEvidence:true,answer:"可以跨学校组队。",citations:[chunk.id]});}};
    const answer=await answerQuestion({question:"团队学生和指导教师是否可以跨学校组队？",documentIds:[doc.id]},env.store,provider);
    assert.equal(answer.mode,"extractive");
    assert.ok(answer.warnings.some(w=>w.includes("规则结论需核对")));
    assert.ok(answer.citations[0].text.includes("同一所高校"));
    provider.generate=async()=>JSON.stringify({hasEvidence:true,answer:"不可以跨学校组队，需来自同一所高校。",citations:[chunk.id]});
    assert.equal((await answerQuestion({question:"学生和指导教师能否跨学校组队",documentIds:[doc.id]},env.store,provider)).mode,"generated");
  } finally {env.close();}
});

test("明确有同届替代通知时，日程检索排除旧通知，资格检索仍保留", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const input={title:"旧通知",sourceUrl:"https://example.edu/original",kind:"notice" as const,year:"2026",competition:"样例赛事",fileName:"old.txt",stage:"原始通知",pages:[{page:null,text:"报名截止时间2026年3月10日16:00。参赛对象为本科生，团队人数不超过三人。"}]};
    const original=env.store.importDocument(input).document;
    const update=env.store.importDocument({...input,title:"调整通知",sourceUrl:"https://example.edu/update",stage:"调整通知；替代原报名时间",pages:[{page:null,text:"报名截止时间延长至2026年3月30日16:00。"}]}).document;
    const latest=await answerQuestion({question:"报名截止时间",documentIds:[original.id,update.id]},env.store,null);
    assert.ok(latest.citations.length && latest.citations.every(c=>c.documentId===update.id));
    const eligibility=await answerQuestion({question:"参赛对象本科生",documentIds:[original.id,update.id]},env.store,null);
    assert.ok(eligibility.citations.some(c=>c.documentId===original.id));
    const scoped=await answerQuestion({question:"报名截止时间",documentIds:[original.id]},env.store,null);
    assert.ok(scoped.citations.some(c=>c.documentId===original.id));
    const anotherYear=env.store.importDocument({...input,title:"下一年",year:"2027",stage:"原始通知",pages:[{page:null,text:"报名截止时间2027年4月10日16:00。"}]}).document;
    const nextYear=await answerQuestion({question:"报名截止时间2027年",documentIds:[anotherYear.id,update.id]},env.store,null);
    assert.ok(nextYear.citations.some(c=>c.documentId===anotherYear.id));
  } finally {env.close();}
});


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

test("模型限流只有限重试，恢复后可引用作答，持续繁忙时提示稍后重试", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const { ModelHttpError } = await import("../src/server/provider");
  const env = await setup();
  try {
    const chunk = env.store.getChunks([env.first.document.id])[0];
    let calls = 0;
    const provider = { chatReady: true, embeddingReady: false, embeddingKey: "none", async embed() { return []; }, async generate() {
      calls++;
      if (calls === 1) throw new ModelHttpError(429);
      return JSON.stringify({ hasEvidence: true, answer: "团队最多三人。", citations: [chunk.id] });
    } };
    const recovered = await answerQuestion({ question: "团队人数" }, env.store, provider);
    assert.equal(recovered.mode, "generated");
    assert.equal(calls, 2);
    calls = 0;
    provider.generate = async () => { calls++; throw new ModelHttpError(429); };
    const busy = await answerQuestion({ question: "团队人数" }, env.store, provider);
    assert.equal(busy.mode, "extractive");
    assert.equal(calls, 2);
    assert.ok(busy.warnings.some(w => w.includes("HTTP 429") && w.includes("稍后重试")));
    assert.ok(busy.citations.every(c => c.documentId === env.first.document.id));
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

test("智谱免费模型关闭深度思考，其他模型与服务不携带专属参数", async () => {
  const { ApiProvider } = await import("../src/server/provider");
  const originalFetch = globalThis.fetch;
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ choices: [{ message: { content: '{"hasEvidence":false,"answer":"","citations":[]}' } }] });
  };
  try {
    for (const [baseUrl, chatModel] of [
      ["https://open.bigmodel.cn/api/paas/v4", "glm-4.7-flash"],
      ["https://example.com/v1", "glm-4.7-flash"],
      ["https://open.bigmodel.cn/api/paas/v4", "other-model"],
    ]) {
      const provider = new ApiProvider({ baseUrl, chatModel, apiKey: "test-secret", embeddingBaseUrl: "", embeddingApiKey: "", embeddingModel: "" });
      assert.equal(provider.embeddingReady, false);
      const reply = await provider.generate("只能按原文作答", "竞赛资料");
      assert.equal(JSON.parse(reply).hasEvidence, false);
    }
    assert.equal(requests[0].url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
    assert.deepEqual(requests[0].body.thinking, { type: "disabled" });
    assert.equal(requests[1].body.thinking, undefined);
    assert.equal(requests[2].body.thinking, undefined);
    assert.deepEqual(requests[0].body.messages, [{ role: "system", content: "只能按原文作答" }, { role: "user", content: "竞赛资料" }]);
  } finally { globalThis.fetch = originalFetch; }
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

test("跨页政策证据按原文顺序交给模型，检索评分不能倒置条款续页", async () => {
  const { answerQuestion } = await import("../src/server/rag");
  const env = await setup();
  try {
    const policy = env.store.importDocument({ title: "跨页政策测试", sourceUrl: "", kind: "policy", year: "2023", stage: "", competition: "", fileName: "policy.txt", pages: [
      { page: 4, text: "B类认定：国际学术团体主办的具有重要影响力的国际竞赛，包括联合国教" },
      { page: 5, text: "科文组织主办的竞赛。C类认定：B类竞赛的省分赛或分区赛。" },
    ] });
    const provider = { chatReady: true, embeddingReady: false, embeddingKey: "none", async embed() { return []; }, async generate(_system: string, user: string) {
      const { passages } = JSON.parse(user);
      assert.deepEqual(passages.map((p: { page: number }) => p.page), [4, 5]);
      return JSON.stringify({ hasEvidence: true, answer: "B类包括具有重要影响力的国际竞赛；B类的省分赛属于C类。", citations: [passages[0].id] });
    } };
    const answer = await answerQuestion({ question: "B类竞赛认定，省分赛或分区赛", documentIds: [policy.document.id] }, env.store, provider);
    assert.equal(answer.mode, "generated");
    assert.deepEqual(answer.citations.map(c => c.page).sort(), [4, 5]);
    assert.ok(answer.warnings.some(w => w.includes("续页原文")));
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
