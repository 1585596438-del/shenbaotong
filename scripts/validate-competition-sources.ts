import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import type { Answer, KnowledgeDocument } from "../src/server/types";

async function main() {
  const imported = JSON.parse(await readFile("artifacts/competition-import.json","utf8")) as {imported:{key:string;document:KnowledgeDocument}[]};
  const documents = new Map(imported.imported.map(item=>[item.key,item.document]));
  const cases = [
    {name:"计算机设计软件类别要求",keys:["design-entry","design-software"],question:"2026年中国大学生计算机设计大赛的软件应用与开发类别，每队几名本科生？Web作品要提供什么网址？",expected:[/2[～~—至-]9/,/互联|访问/]},
    {name:"蓝桥杯Web是个人赛",keys:["lanqiao-software-4"],question:"第十七届蓝桥杯软件赛Web应用开发是个人赛还是团队提交作品？本科生和研究生可以报哪个组？",expected:[/个人/,/大学组/]},
    {name:"服创延期通知覆盖旧日程",keys:["fwwb-notice","fwwb-handbook","fwwb-extension"],question:"2026第十七届服创大赛，报名及选题截止时间最后延长到什么时候？A类初赛作品提交截至什么时候？请按最新延期通知回答。",expected:[/3月31日16[:：]00/,/4月22日16[:：]00/],mustCite:"fwwb-extension"},
    {name:"软件杯教师计入队伍总人数",keys:["softwarecup-registration"],question:"2026第十五届中国软件杯每队最多几名成员，人数是否包括老师？本科生可以报名A组还是B组？可以跨院校组队吗？",expected:[/4/,/老师|教师|指导组/,/A组/,/跨院校|跨校/],forbidden:[/人数不包括老师|不包含指导教师|4名学生/]},
    {name:"人工智能创意赛允许跨校",keys:["c4-ai"],question:"2026人工智能创意赛，能一个人参赛或跨学校组队吗？队伍人数上限和指导老师有什么要求？",expected:[/3/,/跨学校|跨校/,/正式教师/]},
    {name:"ICT年度时间与同校要求",keys:["ict-innovation"],question:"第十一届华为ICT大赛中国创新赛的报名截止日期、学生和教师人数、能否跨学校组队分别是什么？仅使用智谱模型是否就符合赛题要求？",expected:[/11月30日/,/3/,/同一所|同一高校|同校/,/华为/]},
    {name:"信息安全作品赛的研究生资格",keys:["ciscn-reprint"],question:"2026第十九届信息安全作品赛的自由作品赛和命题挑战赛，研究生都可以参加吗？每队学生和老师人数限制是什么？",expected:[/不含研究生|不包含研究生|不可以|不可|不能|不允许|不符合/,/4/,/1/]},
    {name:"下一届未知日期拒答",keys:["design-entry","design-software"],question:"2027年第20届中国大学生计算机设计大赛的报名截止日期是哪天？",noEvidence:true},
    {name:"同类项目跨赛事规则不混淆",keys:["design-software","softwarecup-registration","c4-ai","ict-innovation"],question:"2026软件杯和2026人工智能创意赛都允许跨院校组队吗？两者学生人数上限相同吗？请分别回答。",expected:[/3/,/跨院校|跨校|跨学校/],mustCite:"softwarecup-registration",alsoCite:"c4-ai",forbidden:[/上限不同|没有明确说明|未明确/]},
  ];
  const checks=[];
  for (const test of cases) {
    const scope = test.keys.map(key=>{assert.ok(documents.has(key));return documents.get(key)!.id;});
    const response = await fetch("http://127.0.0.1:3000/api/questions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:test.question,documentIds:scope}),signal:AbortSignal.timeout(75000)});
    const result = await response.json() as {answer:Answer;error?:string};
    assert.ok(response.ok,result.error);
    const answer=result.answer;
    const failures:string[]=[];
    const compact=answer.answer.replace(/\s/g,"");
    if (test.noEvidence) {
      if (answer.mode!=="no_evidence" || answer.citations.length) failures.push("未知年度未拒答");
    } else {
      if (answer.mode!=="generated") failures.push(`没有完成模型问答：${answer.mode}`);
      for (const pattern of test.expected || []) if (!pattern.test(compact)) failures.push(`答案缺少验收要点：${pattern}`);
      for (const pattern of test.forbidden || []) if (pattern.test(compact)) failures.push(`答案出现错误结论：${pattern}`);
      if (!answer.citations.length) failures.push("没有来源");
      for (const citation of answer.citations) {
        const source=imported.imported.find(item=>item.document.id===citation.documentId)?.document;
        if (!scope.includes(citation.documentId) || !source || citation.sourceUrl!==source.sourceUrl) failures.push("引用范围或网址不一致");
        if (source && source.pageCount && (!citation.page || citation.page>source.pageCount)) failures.push("PDF页码不正确");
      }
      if (test.mustCite && !answer.citations.some(c=>c.documentId===documents.get(test.mustCite!)!.id)) failures.push("缺少关键规则引用");
      if (test.alsoCite && !answer.citations.some(c=>c.documentId===documents.get(test.alsoCite!)!.id)) failures.push("跨赛事比较缺少另一赛事依据");
    }
    const safeFallback = answer.mode === "extractive" && answer.warnings.some(w=>w.startsWith("规则结论需核对")) && answer.citations.length>0 && answer.citations.every(c=>scope.includes(c.documentId) && c.sourceUrl===imported.imported.find(item=>item.document.id===c.documentId)?.document.sourceUrl);
    checks.push({name:test.name,passed:failures.length===0,safeFallback,failures,answer});
    await writeFile("artifacts/competition-validation.json",JSON.stringify({time:new Date().toISOString(),checks},null,2));
    console.log(JSON.stringify({name:test.name,passed:!failures.length,safeFallback,mode:answer.mode,answer:answer.answer,failures,warnings:answer.warnings,citations:answer.citations.map(c=>({title:c.title,page:c.page,sourceUrl:c.sourceUrl}))}));
  }
  console.log(`综合问答/拒答通过 ${checks.filter(c=>c.passed).length}/${checks.length} 项；${checks.filter(c=>c.safeFallback).length} 项规则核对退回原文；请人工核对，输出见 artifacts/competition-validation.json。`);
  if (checks.some(c=>!c.passed && !c.safeFallback)) process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
