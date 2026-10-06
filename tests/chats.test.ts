import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {KnowledgeStore} from "../src/server/store";
import {answerQuestion} from "../src/server/rag";
import type {Answer} from "../src/server/types";

function answer(question="测试问题"):Answer {return {id:randomUUID(),question,answer:"测试答案",mode:"no_evidence",retrievalMode:"keyword",citations:[],warnings:[],elapsedMs:1,createdAt:"2026-10-07T00:00:00.000Z"};}
function fixture(){const root=mkdtempSync(path.join(tmpdir(),"shenbaotong-chats-"));const file=path.join(root,"knowledge.sqlite");const store=new KnowledgeStore(file);return{root,file,store,close(){store.close();rmSync(root,{recursive:true,force:true});}};}

test("旧问答增量归入历史聊天，原正文不变，重启不重复归档",()=>{
  const root=mkdtempSync(path.join(tmpdir(),"shenbaotong-chat-migrate-")),file=path.join(root,"knowledge.sqlite");
  const db=new Database(file);db.exec("CREATE TABLE answers(id TEXT PRIMARY KEY,body TEXT NOT NULL,createdAt TEXT NOT NULL)");
  const old=Array.from({length:35},(_,index)=>answer(`旧问题${index}`));
  for(const item of old) db.prepare("INSERT INTO answers VALUES (?,?,?)").run(item.id,JSON.stringify(item),item.createdAt);
  const before=db.prepare("SELECT * FROM answers ORDER BY id").all();db.close();
  let store=new KnowledgeStore(file);
  try{const chats=store.listChats();assert.equal(chats.length,1);assert.equal(chats[0].title,"历史聊天");assert.equal(store.getChat(chats[0].id)!.answers.length,35);store.close();store=new KnowledgeStore(file);assert.equal(store.listChats().length,1);const read=new Database(file,{readonly:true});assert.deepEqual(read.prepare("SELECT * FROM answers ORDER BY id").all(),before);read.close();}finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test("会话独立保存、完整历史不截断、同一毫秒保持发送顺序",()=>{
  const env=fixture();try{const first=env.store.createChat(),second=env.store.createChat();
    assert.equal(env.store.getChat(second.session.id)!.answers.length,0);
    const items=Array.from({length:35},(_,index)=>answer(`问题${index}`));
    items.forEach(item=>env.store.saveAnswer(item,first.session.id));
    assert.deepEqual(env.store.getChat(first.session.id)!.answers,items);
    assert.equal(env.store.getChat(first.session.id)!.session.title,"问题0");
    assert.equal(env.store.getChat(second.session.id)!.answers.length,0);
    env.store.close();const reopened=new KnowledgeStore(env.file);try{assert.deepEqual(reopened.getChat(first.session.id)!.answers,items);}finally{reopened.close();}
  }finally{env.close();}
});

test("跨会话追问被拒绝，新聊天不继承其他赛事上下文",async()=>{
  const env=fixture();try{
    const doc=env.store.importDocument({title:"计算机设计大赛规则",competition:"中国大学生计算机设计大赛",sourceUrl:"",kind:"rule",year:"2026",stage:"国赛",fileName:"rules.txt",pages:[{page:1,text:"中国大学生计算机设计大赛要求学生在同校组队，参赛团队最多三人。"}]}).document;
    const first=env.store.createChat(),second=env.store.createChat();
    const old=await answerQuestion({question:"计算机设计大赛参赛团队最多几人",sessionId:first.session.id,documentIds:[doc.id]},env.store,null);
    assert.equal(env.store.getChat(first.session.id)!.session.documentIds[0],doc.id);
    await assert.rejects(answerQuestion({question:"还有哪些要求",sessionId:second.session.id,previousAnswerId:old.id},env.store,null),/不属于当前聊天/);
    assert.equal(env.store.getChat(second.session.id)!.answers.length,0);
    const fresh=await answerQuestion({question:"还有哪些要求",sessionId:second.session.id},env.store,null);
    assert.equal(fresh.retrievalQuestion,"还有哪些要求");
    const follow=await answerQuestion({question:"还有哪些要求",sessionId:first.session.id},env.store,null);
    assert.match(follow.retrievalQuestion!,/计算机设计大赛/);
  }finally{env.close();}
});

test("不存在会话不写入答案，删除来源同步清理会话引用且保留会话",()=>{
  const env=fixture();try{
    const initial=env.store.listAnswers();assert.throws(()=>env.store.saveAnswer(answer(),"missing"),/聊天不存在/);assert.deepEqual(env.store.listAnswers(),initial);
    const doc=env.store.importDocument({title:"测试来源",competition:"",sourceUrl:"",kind:"rule",year:"2026",stage:"",fileName:"rules.txt",pages:[{page:null,text:"测试比赛团队最多三人。"}]}).document;
    const chunk=env.store.getChunks([doc.id])[0],chat=env.store.createChat(),item=answer();
    item.citations=[{id:chunk.id,documentId:doc.id,title:doc.title,text:chunk.text,page:chunk.page,paragraph:chunk.paragraph,sourceUrl:""}];
    env.store.saveAnswer(item,chat.session.id,[doc.id]);env.store.deleteDocument(doc.id);
    const detail=env.store.getChat(chat.session.id)!;assert.equal(detail.answers.length,0);assert.deepEqual(detail.session.documentIds,[]);assert.equal(detail.session.answerCount,0);
  }finally{env.close();}
});

test("真实聊天路由建档、读取、404与外站写入保护",async()=>{
  const root=mkdtempSync(path.join(tmpdir(),"shenbaotong-chat-api-"));const previous=process.env.RAG_DATA_DIR;
  const globalStore=globalThis as typeof globalThis & {ragStore?:KnowledgeStore;ragStorePath?:string};
  const saved={store:globalStore.ragStore,path:globalStore.ragStorePath};delete globalStore.ragStore;delete globalStore.ragStorePath;process.env.RAG_DATA_DIR=root;
  try{
    const {GET,POST}=await import("../src/app/api/chats/route");const {GET:detail}=await import("../src/app/api/chats/[id]/route");
    const blocked=await POST(new Request("http://127.0.0.1:3000/api/chats",{method:"POST",headers:{origin:"https://example.com"}}));assert.equal(blocked.status,400);
    const created=await POST(new Request("http://127.0.0.1:3000/api/chats",{method:"POST",headers:{origin:"http://127.0.0.1:3000"}}));assert.equal(created.status,201);const chat=await created.json();assert.deepEqual(chat.answers,[]);
    assert.equal((await (await GET()).json()).chats.length,1);
    assert.equal((await detail(new Request("http://127.0.0.1:3000/api/chats/x"),{params:Promise.resolve({id:"x"})})).status,404);
    assert.equal((await detail(new Request(`http://127.0.0.1:3000/api/chats/${chat.session.id}`),{params:Promise.resolve({id:chat.session.id})})).status,200);
  }finally{(globalThis as typeof globalThis & {ragStore?:KnowledgeStore}).ragStore?.close();globalStore.ragStore=saved.store;globalStore.ragStorePath=saved.path;if(previous===undefined)delete process.env.RAG_DATA_DIR;else process.env.RAG_DATA_DIR=previous;rmSync(root,{recursive:true,force:true});}
});
