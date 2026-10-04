import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Entry = { key: string; title: string; kind: string; year: string; stage: string; competition: string; sourceUrl: string; file: string; start?: string; end?: string; omitBetween?: [string,string] };
async function main() {
const manifestPath = process.argv[2] || "docs/competition-sources-2026-10-05.json";
const sourceRoot = path.resolve(process.argv[3] || "data/sources/2026-10-05");
// Local import only; this script never downloads pages or calls an AI provider itself.
const base = "http://127.0.0.1:3000";
const manifest = JSON.parse((await readFile(manifestPath,"utf8")).replace(/^\uFEFF/,"")) as {entries:Entry[]};
const prepared = await Promise.all(manifest.entries.map(async entry => {
  const filePath = path.resolve(sourceRoot,entry.file);
  if (!filePath.startsWith(sourceRoot+path.sep)) throw new Error(`资料路径越界：${entry.key}`);
  const bytes = await readFile(filePath);
  if (!bytes.length || bytes.length > 10*1024*1024) throw new Error(`资料大小不合法：${entry.key}`);
  let text: string | undefined;
  if (entry.file.endsWith(".txt")) {
    text = new TextDecoder("utf8",{fatal:true}).decode(bytes).replace(/^\uFEFF/,"");
    for (const [field,marker] of [["start",entry.start],["end",entry.end]] as const) {
      if (!marker) continue;
      const index = text.indexOf(marker);
      if (index < 0) throw new Error(`${entry.key}: 找不到${field}正文边界`);
      text = field === "start" ? text.slice(index) : text.slice(0,index);
    }
    if (entry.omitBetween) {
      const [start,end] = entry.omitBetween.map(marker=>text!.indexOf(marker));
      if (start<0 || end<=start) throw new Error(`${entry.key}: 排除片段边界错误`);
      text = text.slice(0,start)+"\n\n"+text.slice(end);
    }
    text = text.trim();
    if (text.length < 150 || text.length > 1_000_000) throw new Error(`${entry.key}: 正文为空或过长`);
  } else if (!entry.file.endsWith(".pdf") || bytes.subarray(0,5).toString() !== "%PDF-") {
    throw new Error(`${entry.key}: 不是有效PDF`);
  }
  return {entry,bytes,text,sha256:createHash("sha256").update(bytes).digest("hex")};
}));
await mkdir("artifacts",{recursive:true});
const imported = [];
for (const {entry,bytes,text,sha256} of prepared) {
  const form = new FormData();
  for (const field of ["title","kind","year","stage","competition","sourceUrl"] as const) form.set(field,entry[field]);
  if (text !== undefined) form.set("text",text);
  else form.set("file",new File([bytes],entry.file,{type:"application/pdf"}));
  const response = await fetch(`${base}/api/documents`,{method:"POST",body:form,signal:AbortSignal.timeout(60000)});
  const result = await response.json();
  if (!response.ok) throw new Error(`${entry.key}: ${result.error}`);
  const record = {key:entry.key,sha256,document:result.document,duplicate:result.duplicate,warnings:result.warnings};
  imported.push(record);
  await writeFile("artifacts/competition-import.json",JSON.stringify({manifestPath,time:new Date().toISOString(),imported},null,2));
  console.log(JSON.stringify({key:entry.key,duplicate:result.duplicate,pages:result.document.pageCount,chunks:result.document.chunkCount,warnings:result.warnings}));
}
console.log(`已导入 ${imported.length} 份资料；结果见 artifacts/competition-import.json`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
