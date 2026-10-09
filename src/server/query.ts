import type { Answer, KnowledgeDocument, RankedChunk, Chunk } from "./types";

const competitions = [
  ["计算机设计", "中国大学生计算机设计大赛", "计算机设计大赛"],
  ["蓝桥杯"],
  ["软件杯", "中国软件杯"],
  ["服务外包", "服务外包创新创业大赛", "服务外包大赛", "服创大赛", "服创"],
  ["华为ict", "ict大赛", "华为创新赛"],
  ["人工智能创意赛", "c4-ai"],
  ["天梯赛", "团体程序设计天梯赛", "程序设计天梯赛"],
  ["信息安全竞赛", "信息安全作品赛", "信息安全大赛"],
  ["信息安全与对抗技术竞赛", "iscc"],
];
const normalize = (text: string) => text.toLowerCase().replace(/[\s“”"'·／/（）()_-]/g, "");
function topics(text: string) { const value = normalize(text); return competitions.filter(aliases => aliases.some(alias => value.includes(normalize(alias)))); }
function resolveYear(question: string, date: Date) {
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" }).format(date));
  return question.replace(/今年|本年度|本年/g, `${year}年`).replace(/明年|下一年/g, `${year + 1}年`).replace(/去年|上一年/g, `${year - 1}年`);
}

export function planRetrieval(question: string, documents: KnowledgeDocument[], previous?: Answer, now = new Date()) {
  const current = resolveYear(question, now);
  const named = topics(current);
  const explicitNames = documents.map(d => d.competition.split(/[／/]/)[0]).filter(name => name.length >= 3 && normalize(current).includes(normalize(name)));
  // 只将明确的追问继承为检索主题；先前生成的答案不能当作事实证据。
  const followUp = !!previous && !named.length && !explicitNames.length && /详细|讲一下|介绍一下|展开|具体|它|这个|这些|上面|继续|还有|那|多少人|要交什么|怎么报名|什么时候|截止|人数|费用|材料|组队|资格/.test(question);
  const previousQuestion = followUp ? resolveYear(previous!.retrievalQuestion || previous!.question, new Date(previous!.createdAt)).slice(0, 1600) : "";
  const retrievalQuestion = previousQuestion ? `${previousQuestion}\n用户追问：${current}` : current;
  const targets = named.length ? named : topics(previousQuestion);
  const policy = /[abcd]类|认定|学分|管理办法|学校.*奖励/i.test(question);
  let candidates = documents;
  const schoolPolicy = /认定|学分|管理办法|学校.*(?:类别|分类|奖励)/.test(current);
  if (schoolPolicy) candidates = candidates.filter(doc => ["policy", "catalog"].includes(doc.kind));
  if (targets.length) {
    candidates = candidates.filter(doc => {
      if (policy && ["policy", "catalog"].includes(doc.kind)) return true;
      if (["policy", "catalog"].includes(doc.kind)) return false;
      const identity = normalize(doc.competition || doc.title);
      return targets.some(aliases => aliases.some(alias => identity.includes(normalize(alias))));
    });
  } else {
    // 新导入赛事可用元数据全名定位，不依赖内置名单。
    if (explicitNames.length) candidates = candidates.filter(d => explicitNames.some(name => d.competition.startsWith(name)) || (policy && ["policy", "catalog"].includes(d.kind)));
    else if (followUp && previous!.citations.length) candidates = candidates.filter(d => previous!.citations.some(c => c.documentId === d.id));
  }
  const years = [...new Set((current.match(/20\d{2}/g) ?? []))];
  if (!years.length && previousQuestion) years.push(...new Set(previousQuestion.match(/20\d{2}/g) ?? []));
  if (years.length && (targets.length || explicitNames.length)) candidates = candidates.filter(d => {
    if (policy && ["policy", "catalog"].includes(d.kind)) return true;
    const recorded = d.year || (d.title.match(/20\d{2}/g) ?? []).join("、");
    // 未填写年份的资料仍检索原文核对，不能仅因元数据空白漏掉已抓取内容。
    return !recorded || years.some(year => recorded.includes(year));
  });
  if (targets.some(aliases => aliases.includes("蓝桥杯"))) {
    const tracks = ["python", "java", "c/c++", "web", "网络安全", "软件测试"].filter(track => normalize(retrievalQuestion).includes(normalize(track)));
    if (tracks.length) candidates = candidates.filter(d => !normalize(d.competition || d.title).includes("蓝桥杯") || tracks.some(track => normalize(d.competition + d.title).includes(normalize(track))) || (/时间|日期|截止|赛程|报名/.test(current) && d.kind === "notice"));
  }
  if (targets.some(aliases => aliases.includes("iscc"))) {
    const region = ["河南", "上海", "综合"].find(value => current.includes(value));
    if (region && !schoolPolicy) candidates = candidates.filter(d => (d.title + d.stage).includes(region));
  }
  // 赛事全名已用于限定来源；条款检索再突出用户实际询问的条件。
  let focusQuestion = normalize(retrievalQuestion);
  for (const name of [...new Set(explicitNames)].sort((a, b) => b.length - a.length)) focusQuestion = focusQuestion.replaceAll(normalize(name), " ");
  focusQuestion = focusQuestion.replace(/20\d{2}年?/g, " ").trim();
  return { retrievalQuestion, previousQuestion, documents: candidates, topicMatched: !!targets.length || !!explicitNames.length, focusQuestion: explicitNames.length ? focusQuestion : "" };
}

// 补齐短标题后紧邻的条款，不重新分块数据库，引用仍使用实际原文片段 ID。
export function expandEvidence(seeds: RankedChunk[], scope: Chunk[]) {
  const result = [...seeds], included = new Set(seeds.map(c => c.id));
  let characters = result.reduce((sum, c) => sum + c.text.length, 0);
  for (const seed of seeds) {
    if (seed.text.trim().length >= 300) continue;
    const sameDocument = scope.filter(c => c.documentId === seed.documentId);
    const index = sameDocument.findIndex(c => c.id === seed.id);
    let contextLength = seed.text.length;
    const neighbors = [sameDocument[index - 1], ...sameDocument.slice(index + 1, index + 9)];
    for (const neighbor of neighbors) {
      if (!neighbor || neighbor.page !== seed.page || contextLength >= 1000 || result.length >= 24 || characters + neighbor.text.length > 18_000) continue;
      contextLength += neighbor.text.length;
      if (included.has(neighbor.id)) continue;
      included.add(neighbor.id); characters += neighbor.text.length;
      result.push({ ...neighbor, score: seed.score, lexicalScore: seed.lexicalScore, vectorScore: seed.vectorScore });
    }
  }
  return result;
}
