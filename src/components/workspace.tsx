"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Answer, ChatDetail, ChatSession, Citation, KnowledgeDocument, Chunk } from "@/server/types";
import { ChatPanel } from "./chat-panel";
import { CompetitionLibrary } from "./competition-library";
import { ModelSettings } from "./model-settings";
import type { WebCapture } from "@/server/webpages";

type Status = { documents: KnowledgeDocument[]; answers: Answer[]; chats: ChatSession[]; model: { chatReady: boolean; embeddingReady: boolean; chatModel: string; embeddingModel: string; embeddingKey: string; embeddingIssue?: string; indexedDocuments?: number } };
type Detail = KnowledgeDocument & { chunks: Omit<Chunk, "embedding" | "embeddingKey">[] };
const kinds: Record<string, string> = { catalog: "竞赛目录", policy: "学校政策", notice: "比赛通知", rule: "竞赛规则" };
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败，请重试。");
  return data as T;
}
function location(c: { page: number | null; paragraph: number }) { return c.page === null ? `第 ${c.paragraph} 段` : `第 ${c.page} 页 · 片段 ${c.paragraph}`; }
function Icon({ name }: { name: "chat" | "book" | "settings" | "plus" | "arrow" }) {
  const paths = { chat: "M4 4h16v12H9l-5 4V4Z", book: "M4 3h11l5 5v13H4V3Zm11 0v5h5M8 12h8M8 16h6", settings: "M4 7h16M4 17h16M9 4v6M16 14v6", plus: "M12 5v14M5 12h14", arrow: "M5 12h14M13 6l6 6-6 6" };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Workspace() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTab] = useState<"chat" | "library" | "competitions" | "settings">("chat");
  const ruleEdit = useRef({ dirty: false, busy: false });
  const modelEdit = useRef({ dirty: false, busy: false });
  const modelEditChanged = useCallback((dirty: boolean, busy: boolean) => { modelEdit.current = { dirty, busy }; }, []);
  const ruleEditChanged = useCallback((dirty: boolean, busy: boolean) => { ruleEdit.current = { dirty, busy }; }, []);
  function mayLeaveRules() {
    if (modelEdit.current.busy) return false;
    if (modelEdit.current.dirty && !window.confirm("有未保存的API配置，是否放弃修改并离开？")) return false;
    if (ruleEdit.current.busy) return false;
    if (ruleEdit.current.dirty && !window.confirm("有未保存的规则修改，是否放弃修改并离开？")) return false;
    ruleEdit.current = { dirty: false, busy: false };
    modelEdit.current = { dirty: false, busy: false };
    return true;
  }
  function switchTab(next: typeof tab) { if (next === tab || mayLeaveRules()) {setTab(next);setSidebarOpen(false);} }
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => { if (ruleEdit.current.dirty || ruleEdit.current.busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, []);
  const [selected, setSelected] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "text" | "url">("file");
  const [importTitle, setImportTitle] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [dynamicWeb, setDynamicWeb] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [capture, setCapture] = useState<WebCapture | null>(null);
  const [activeAnswer, setActiveAnswer] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeChat = useRef<string | null>(null);
  const chatDrafts = useRef(new Map<string,{question:string;documentIds:string[]}>());
  const [preview, setPreview] = useState<Detail | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [indexing, setIndexing] = useState<string | null>(null);
  const sourceRequest = useRef(0);
  const documents = status?.documents ?? [];
  const answers = chat?.answers ?? [];
  const answer = answers.find(a => a.id === activeAnswer) ?? answers.at(-1);

  async function refresh() {
    const current = await api<Status>("/api/status");
    setStatus(current);
    setSelected(ids => ids.filter(id => current.documents.some(d => d.id === id)));
    if (activeChat.current) {
      const id = activeChat.current;
      const detail = await api<ChatDetail>(`/api/chats/${id}`);
      if (activeChat.current === id) setChat(detail);
    }
  }
  useEffect(() => {
    let cancelled = false;
    api<Status>("/api/status").then(async current => {
      if (cancelled) return;
      setStatus(current);
      let id: string | null = null;
      try { id = localStorage.getItem("shenbaotong.activeChat"); } catch { /* Storage can be unavailable. */ }
      if (!id || !current.chats.some(item=>item.id===id)) return;
      setChatLoading(true);
      const detail = await api<ChatDetail>(`/api/chats/${id}`);
      if (cancelled) return;
      activeChat.current = id; setChat(detail); setSelected(detail.session.documentIds);
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(()=>{if (!cancelled) setChatLoading(false);});
    return ()=>{cancelled=true;};
  }, []);
  function rememberChat(id: string) {
    try { localStorage.setItem("shenbaotong.activeChat",id); } catch { /* Chats still persist in SQLite. */ }
  }
  useEffect(()=>{
    if (!sidebarOpen || tab !== "chat" || !window.matchMedia("(max-width:640px)").matches) return;
    const previous=document.activeElement as HTMLElement | null;
    const sidebar=document.querySelector<HTMLElement>(".sidebar");
    const focusable=()=>Array.from(sidebar?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)') ?? []).filter(element=>!element.closest("[hidden]"));
    focusable()[0]?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();setSidebarOpen(false);}
      if(event.key==="Tab"){const elements=focusable(),first=elements[0],last=elements.at(-1);if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}}
    };
    document.addEventListener("keydown",key);
    return ()=>{document.removeEventListener("keydown",key);if(previous?.isConnected)previous.focus();};
  },[sidebarOpen,tab]);
  async function chooseChat(id?: string) {
    if (busy || chatLoading || !mayLeaveRules()) return;
    if (id === activeChat.current) { setTab("chat"); setSidebarOpen(false); return; }
    chatDrafts.current.set(activeChat.current ?? "",{question,documentIds:selected});
    setChatLoading(true); setError("");
    try {
      const detail = await api<ChatDetail>(id ? `/api/chats/${id}` : "/api/chats",id ? undefined : {method:"POST"});
      activeChat.current = detail.session.id; rememberChat(detail.session.id);
      const draft = chatDrafts.current.get(detail.session.id);
      setChat(detail); setSelected(draft?.documentIds.filter(id=>documents.some(doc=>doc.id===id)) ?? detail.session.documentIds); setQuestion(draft?.question ?? "");
      setActiveAnswer(null); setEvidenceOpen(false); setScopeOpen(false); setSidebarOpen(false); setNotice(""); setTab("chat");
      setStatus(old=>old ? {...old,chats:[detail.session,...old.chats.filter(item=>item.id!==detail.session.id)]} : old);
    } catch(e) {setError(e instanceof Error ? e.message : "聊天加载失败，请重试。");}
    finally {setChatLoading(false);}
  }
  useEffect(() => {
    if (importing) { setImportTitle(""); setCapture(null); setWebUrl(""); setDynamicWeb(false); }
  }, [importing]);
  useEffect(() => {
    const conversation = document.querySelector<HTMLElement>(".conversation");
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [answers.at(-1)?.id, busy, tab]);
  useEffect(() => {
    const evidence = document.querySelector<HTMLElement>(".evidence-panel");
    if (evidence) evidence.scrollTop = 0;
  }, [answer?.id, tab]);
  useEffect(() => {
    if (!importing && !preview) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]') ?? []);
    if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !uploading && !crawling) { setImporting(false); sourceRequest.current++; setPreview(null); }
      if (event.key === "Tab") {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [importing, preview, uploading, crawling]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy || chatLoading || !status) return;
    setBusy(true); setError(""); setNotice("");
    try {
      let sessionId = activeChat.current;
      if (!sessionId) {
        const detail = await api<ChatDetail>("/api/chats",{method:"POST"});
        sessionId=detail.session.id; activeChat.current=sessionId; rememberChat(sessionId); setChat(detail);
        setStatus(old=>old ? {...old,chats:[detail.session,...old.chats]} : old);
      }
      const result = await api<{ answer: Answer; session: ChatSession }>("/api/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, documentIds: selected, previousAnswerId: answers.at(-1)?.id, sessionId }) });
      const detail = {session:result.session,answers:[...answers,result.answer]};
      setChat(detail);
      setStatus(old => old ? { ...old, chats:[detail.session,...old.chats.filter(item=>item.id!==sessionId)] } : old);
      chatDrafts.current.delete(sessionId);
      setActiveAnswer(result.answer.id); setQuestion("");
    } catch (e) { setError(e instanceof Error ? e.message : "问答失败。"); }
    finally { setBusy(false); }
  }
  async function importDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading || crawling || (importMode === "url" && !capture)) return;
    setUploading(true); setError(""); setNotice("");
    try {
      const result = await api<{ document: KnowledgeDocument; duplicate: boolean; warnings: string[] }>("/api/documents", { method: "POST", body: new FormData(event.currentTarget) });
      await refresh();
      setNotice(`${result.duplicate ? "资料已存在，未重复添加" : "资料导入成功"}：${result.document.title}。${result.warnings.join(" ")}`);
      setImporting(false); switchTab("library");
    } catch (e) { setError(e instanceof Error ? e.message : "导入失败。"); }
    finally { setUploading(false); }
  }
  async function fetchWebpage(url = webUrl, attachment = false) {
    if (crawling || uploading || !url.trim()) return;
    setCrawling(true); setCapture(null); setError(""); setNotice("");
    if (attachment) { setWebUrl(url); setDynamicWeb(false); }
    try {
      const result = await api<WebCapture>("/api/webpages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, dynamic: attachment ? false : dynamicWeb }) });
      setCapture(result); setImportTitle(result.title);
    } catch (e) { setError(e instanceof Error ? e.message : "网页抓取失败。"); }
    finally { setCrawling(false); }
  }
  async function openSource(id: string, chunkId?: string) {
    const request = ++sourceRequest.current;
    try {
      const result = await api<{ document: Detail }>(`/api/documents/${id}`);
      if (request !== sourceRequest.current) return;
      setPreview(result.document); setHighlight(chunkId ?? null);
      if (chunkId) setTimeout(() => { if (request === sourceRequest.current) document.getElementById(`source-${chunkId}`)?.scrollIntoView({ block: "center" }); }, 100);
    } catch (e) { if (request === sourceRequest.current) setError(e instanceof Error ? e.message : "原文加载失败。"); }
  }
  async function removeDocument(doc: KnowledgeDocument) {
    if (!window.confirm(`删除“${doc.title}”及引用它的问答记录？`)) return;
    try { await api(`/api/documents/${doc.id}`, { method: "DELETE" }); await refresh(); setNotice("资料及其引用记录已删除。"); }
    catch (e) { setError(e instanceof Error ? e.message : "删除失败。"); }
  }
  async function index(doc: KnowledgeDocument) {
    setIndexing(doc.id); setError("");
    try { await api(`/api/documents/${doc.id}/index`, { method: "POST" }); await refresh(); setNotice("向量索引已建立。"); }
    catch (e) { setError(e instanceof Error ? e.message : "索引失败。"); }
    finally { setIndexing(null); }
  }
  function evidence(citation: Citation, i: number) {
    return <article className="evidence-card" key={citation.id}>
      <div className="evidence-top"><span className="source-number">{String(i + 1).padStart(2, "0")}</span><span>{location(citation)}</span></div>
      <h3>{citation.title}</h3><p className="passage">{citation.text}</p>
      <div className="evidence-actions"><button onClick={() => openSource(citation.documentId, citation.id)}>查看原文 <span aria-hidden="true">↗</span></button>{citation.sourceUrl ? <a href={citation.sourceUrl} target="_blank" rel="noopener noreferrer">来源网址 ↗</a> : <span className="muted">本地附件 · 无公开网址</span>}</div>
    </article>;
  }

  return <div className={`workspace ${tab === "chat" ? "chat-workspace" : ""} ${sidebarOpen ? "chat-sidebar-open" : ""}`}>
    {tab === "chat" && sidebarOpen && <button className="chat-sidebar-scrim" aria-label="关闭聊天侧栏" onClick={()=>setSidebarOpen(false)} />}
    <aside className="sidebar">
      {tab === "chat" && sidebarOpen && <button className="chat-sidebar-close" aria-label="关闭聊天记录" onClick={()=>setSidebarOpen(false)}>×</button>}
      <a className="brand" href="/" onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; if (!mayLeaveRules()) event.preventDefault(); }} aria-label="申报通知识库首页"><span className="brand-mark">申</span><span>申报通<small>校园竞赛知识库</small></span></a>
      <nav aria-label="工作台导航">{(["chat", "library", "competitions", "settings"] as const).map(t => <button className={tab === t ? "nav-item active" : "nav-item"} key={t} onClick={() => switchTab(t)}><Icon name={t === "library" || t === "competitions" ? "book" : t} />{({ chat: "知识问答", library: "资料库", competitions: "竞赛规则", settings: "运行设置" })[t]}{t === "library" && <span className="count">{documents.length}</span>}</button>)}</nav>
      {tab === "chat" && <><button className="new-chat" disabled={!status || busy || chatLoading} onClick={()=>chooseChat()}><Icon name="plus" />新建聊天</button><section className="chat-history" aria-label="聊天记录"><h2>最近聊天</h2>{status?.chats.map(item=><button key={item.id} className={chat?.session.id===item.id ? "chat-history-item active" : "chat-history-item"} disabled={busy || chatLoading} onClick={()=>chooseChat(item.id)} title={item.title}><Icon name="chat" /><span>{item.title}</span><small>{item.answerCount || "新"}</small></button>)}{status && !status.chats.length && <p>你的聊天会保存在这里</p>}</section></>}
      <fieldset className="scope-controls" hidden={tab === "chat" && !scopeOpen} disabled={busy || chatLoading}>
      <div className="scope-heading"><span>本次检索范围</span><button onClick={() => setSelected([])} disabled={!selected.length}>重置</button></div>
      <label className="scope-all"><input type="checkbox" checked={!selected.length} onChange={() => setSelected([])} />全部资料 <span>{documents.length}</span></label>
      <div className="scope-list">{documents.map(doc => <label className={selected.includes(doc.id) ? "scope-doc checked" : "scope-doc"} key={doc.id}><input type="checkbox" checked={selected.includes(doc.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, doc.id] : ids.filter(id => id !== doc.id))} /><span>{doc.title}<small>{doc.year || "年份未标注"} · {kinds[doc.kind]}</small></span></label>)}{!documents.length && <p className="sidebar-empty">导入资料后，可以选择只在指定文档中查找。</p>}</div>
      </fieldset>
      <div className="sidebar-bottom"><span className="local-dot" />本地工作区<small>资料保存在本机</small></div>
    </aside>
    <main className="main">
      <header className="topbar">{tab === "chat" && <button className="chat-sidebar-toggle" aria-label="打开聊天记录" aria-expanded={sidebarOpen} onClick={()=>setSidebarOpen(value=>!value)}>☰</button>}<div className="breadcrumb">工作台 <span>/</span> {({ chat: "知识问答", library: "资料库", competitions: "竞赛规则", settings: "运行设置" })[tab]}</div><button className="primary small" onClick={() => { setError(""); setImporting(true); }}><Icon name="plus" />导入资料</button></header>
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">SHENBAOTONG / KNOWLEDGE</p><h1>{({ chat: "让每个答案，都有出处。", library: "从原始资料，建立知识。", competitions: "把比赛要求，逐条查清。", settings: "连接模型，开启引用问答。" })[tab]}</h1><p>{tab === "chat" ? "查目录、读政策、找要求。答案与原文放在一起核对。" : tab === "library" ? "按年度和阶段收集资料，保留每个片段的页码与来源。" : tab === "competitions" ? "按届次与赛道核对规则，保留未知项和原文依据。" : "选择服务商并填写 API 配置，保存后即可使用。"}</p></div><span className="mode-badge"><span className="local-dot" />{status?.model.chatReady ? "文本模型已配置" : "原文检索模式"}</span></div>
        {error && <div className="alert error" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError("")}>×</button></div>}
        {notice && <div className="alert success" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
        {!status && !error && <p className="loading" role="status">正在加载本地知识库…</p>}
        {tab === "chat" && <div className={`dialogue-layout ${evidenceOpen ? "with-evidence" : ""}`}>
          <ChatPanel answers={answers} activeAnswer={answer?.id} question={question} busy={busy} loading={chatLoading || !status} documents={documents.length} selected={selected.length} scopeOpen={scopeOpen} title={chat?.session.title} onQuestion={setQuestion} onAsk={ask} onScope={()=>{setScopeOpen(value=>!value);setSidebarOpen(true);}} onEvidence={id=>{setActiveAnswer(id);setEvidenceOpen(true);}} onImport={()=>setImporting(true)} />
          {evidenceOpen && <aside className="evidence-panel" aria-label="原文依据"><div className="panel-heading"><h2>原文依据 · {answer?.citations.length ?? 0} 条</h2><button className="close-evidence" aria-label="关闭原文依据" onClick={()=>setEvidenceOpen(false)}>×</button></div>{answer && <p className="evidence-question">对应问题：{answer.question}</p>}{answer?.citations.length ? answer.citations.map(evidence) : <div className="evidence-empty"><Icon name="book" /><p>本次未找到依据，可以补充资料或调整范围。</p></div>}</aside>}
        </div>}
        {tab === "library" && <section className="library"><div className="library-summary"><div><strong>{documents.length}</strong><span>份来源文档</span></div><div><strong>{documents.reduce((n, d) => n + d.chunkCount, 0)}</strong><span>个原文片段</span></div><div><strong>{documents.reduce((n, d) => n + d.indexedCount, 0)}</strong><span>个向量片段</span></div></div><div className="section-heading"><h2>来源文档</h2><span>同内容、同来源和同年度的资料自动去重</span></div>{!documents.length && <div className="library-empty"><h2>资料库还是空的</h2><p>先导入真实资料，再验证问题与出处。</p><button className="primary" onClick={() => setImporting(true)}>导入第一份资料</button></div>}{documents.map(doc => {
          const ready = doc.indexedCount === doc.chunkCount && doc.embeddingKey === status?.model.embeddingKey;
          return <article className="document-row" key={doc.id}><span className="document-icon"><Icon name="book" /></span><div className="document-info"><div className="document-labels"><span>{kinds[doc.kind]}</span><span>{doc.year || "年份未标注"}</span>{doc.stage && <span>{doc.stage}</span>}</div><h3>{doc.title}</h3><p>{doc.pageCount ? `${doc.pageCount} 页 · ` : ""}{doc.chunkCount} 个片段 · {doc.characterCount.toLocaleString()} 字符 <span className={ready ? "index-state ready" : "index-state"}>{ready ? "向量索引就绪" : doc.indexedCount ? "需要重新索引" : "可用原文检索"}</span></p></div><div className="document-actions"><button className="outline small" onClick={() => openSource(doc.id)}>查看原文</button><button className="text-button" disabled={indexing !== null || !status?.model.embeddingReady} onClick={() => index(doc)} title={!status?.model.embeddingReady ? "先在运行设置中配置嵌入模型" : "重新建立此文档的向量索引"}>{indexing === doc.id ? "索引中…" : ready ? "重新索引" : "建立索引"}</button><button className="delete-button" onClick={() => removeDocument(doc)}>删除</button></div></article>;
        })}</section>}
        {tab === "competitions" && <CompetitionLibrary onEditState={ruleEditChanged} documents={documents} onSource={openSource} onLibrary={() => switchTab("library")} onAsk={ids => { if (!mayLeaveRules()) return; setSelected(ids.filter(id => documents.some(doc => doc.id === id))); setTab("chat"); setNotice("已选择该规则的原文范围，请输入问题后发送。"); }} />}
        {tab === "settings" && <section className="settings"><ModelSettings onSaved={refresh} onEditState={modelEditChanged} /><div className="settings-card"><h2>当前运行状态</h2><dl><dt>文本模型</dt><dd>{status?.model.chatReady ? status.model.chatModel : "未配置 · 展示原文片段"}</dd><dt>嵌入模型</dt><dd>{status?.model.embeddingReady ? status.model.embeddingModel === "local:bge-small-zh-v1.5" ? "本机免费中文模型 · BGE Small" : status.model.embeddingModel : status?.model.embeddingIssue || (status?.model.embeddingModel === "local:bge-small-zh-v1.5" ? "本机模型尚未下载" : "未配置 · 使用关键词检索")}</dd><dt>向量索引</dt><dd>{status?.model.indexedDocuments ?? 0} / {documents.length} 份资料已按当前模型建立索引</dd><dt>数据保存</dt><dd>本机 SQLite 数据库</dd></dl><p className="settings-note">向量检索需要嵌入模型和资料索引同时就绪。切换嵌入模型后，请在资料库重新建立索引；聊天模型可以独立切换。</p></div><div className="settings-card"><h2>资料与答案的边界</h2><p>目录收录、学校认定和当年比赛要求应分别查证。历史附件无法证明当前报名时间。没有公开网址的本地资料显示文档标题与页码，系统不会编造网址。</p><p>支持含文字层 PDF、TXT、Markdown 与粘贴正文。单文件最多10MB、50页；扫描件暂不支持识别。</p></div></section>}
      </div>
    </main>
    {importing && <div className="modal-backdrop"><section className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="modal-heading"><div><p className="eyebrow">ADD SOURCE</p><h2 id="import-title">导入知识资料</h2></div><button className="close-button" aria-label="关闭导入窗口" disabled={uploading || crawling} onClick={() => setImporting(false)}>×</button></div>
      <p className="modal-description">保留真实来源与年度，让后续回答可以核对。</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      <form onSubmit={importDocument}>
        <div className="import-tabs">{([["file", "上传文件"], ["text", "粘贴正文"], ["url", "网址抓取"]] as const).map(([mode, label]) => <button key={mode} type="button" disabled={uploading || crawling} className={importMode === mode ? "active" : ""} onClick={() => { setImportMode(mode); setError(""); }}>{label}</button>)}</div>
        {importMode === "url" && <div className="web-capture">
          <label className="field">通知或规则网址<input type="url" value={webUrl} disabled={crawling || uploading} onChange={e => { setWebUrl(e.target.value); setCapture(null); }} maxLength={2000} placeholder="https://… 官方通知页面或 PDF 链接" /></label>
          <div className="crawl-toolbar"><label><input type="checkbox" checked={dynamicWeb} disabled={crawling || uploading} onChange={e => { setDynamicWeb(e.target.checked); setCapture(null); }} />动态网页（正文缺失时可勾选重试）</label><button className="outline small" type="button" disabled={crawling || uploading || !webUrl.trim()} onClick={() => fetchWebpage()}>{crawling ? "正在读取网页…" : capture ? "重新抓取" : "抓取正文"}</button></div>
          {crawling && <p className="loading" role="status">正在读取正文和附件链接，动态页面可能需要几十秒…</p>}
          {capture && <div className="crawl-preview">
            <p className="crawl-meta">{({ html: "网页正文", browser: "动态网页正文", pdf: "PDF 附件" })[capture.method]} · {capture.text.length.toLocaleString()} 字符{capture.pageCount ? ` · ${capture.pageCount} 页` : ""}<a href={capture.sourceUrl} target="_blank" rel="noopener noreferrer">核对原网页 ↗</a></p>
            <label className="field">抓取正文预览<textarea readOnly rows={8} value={capture.text} /></label>
            {capture.warnings.map(w => <p className="crawl-warning" key={w}>{w}</p>)}
            {!!capture.attachments.length && <div className="crawl-attachments"><strong>页面附件</strong>{capture.attachments.map(a => <div key={a.url}><a href={a.url} target="_blank" rel="noopener noreferrer">{a.title || "下载附件"} ↗</a>{a.pdf && <button type="button" className="text-button" disabled={uploading || crawling} onClick={() => fetchWebpage(a.url, true)}>抓取此 PDF</button>}</div>)}</div>}
            <input type="hidden" name="captureId" value={capture.captureId} />
          </div>}
        </div>}
        <label className="field">文档标题<input name="title" required maxLength={160} value={importTitle} onChange={e => setImportTitle(e.target.value)} placeholder="例如：2024年B类竞赛目录" /></label>
        <div className="form-row"><label className="field">资料类型<select name="kind" defaultValue="notice">{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="field">资料年份<input name="year" maxLength={40} placeholder="如 2026，按通知内容填写" /></label></div>
        <div className="form-row"><label className="field">赛事名称<input name="competition" maxLength={160} placeholder="多赛事目录可留空" /></label><label className="field">比赛阶段<input name="stage" maxLength={80} placeholder="如 校赛 / 省赛 / 国赛" /></label></div>
        {importMode !== "url" && <label className="field">来源网址<span className="optional">可选</span><input name="sourceUrl" type="url" maxLength={2000} placeholder="完整通知网址，没有公开网址可留空" /></label>}
        {importMode === "file" && <label className="file-field">选择 PDF / TXT / MD 文件<input type="file" name="file" accept=".pdf,.txt,.md" required /><small>含文字层 PDF · 最多10MB / 50页</small></label>}
        {importMode === "text" && <label className="field">资料正文<textarea name="text" rows={7} required maxLength={1_000_000} placeholder="粘贴通知原文，保留完整条款。" /></label>}
        <div className="modal-footer"><span>{importMode === "url" ? "核对正文、资料年份和阶段后入库" : "正文先保存，配置模型后可建立向量索引"}</span><button className="primary" type="submit" disabled={uploading || crawling || (importMode === "url" && !capture)}>{uploading ? "解析并保存中…" : importMode === "url" ? "确认入库" : "导入资料"}</button></div>
      </form>
    </section></div>}
    {preview && <div className="modal-backdrop"><section className="modal source-modal" role="dialog" aria-modal="true" aria-labelledby="source-title"><div className="modal-heading"><div><p className="eyebrow">ORIGINAL SOURCE</p><h2 id="source-title">{preview.title}</h2></div><button className="close-button" aria-label="关闭原文窗口" onClick={() => { sourceRequest.current++; setPreview(null); }}>×</button></div><div className="source-meta">{preview.year || "年份未标注"} · {kinds[preview.kind]} · {preview.fileName}{preview.sourceUrl && <a href={preview.sourceUrl} target="_blank" rel="noopener noreferrer">打开来源网址 ↗</a>}</div><div className="source-scroll">{preview.chunks.map(c => <article id={`source-${c.id}`} className={c.id === highlight ? "source-passage highlighted" : "source-passage"} key={c.id}><h3>{location(c)}</h3><p>{c.text}</p></article>)}</div></section></div>}
  </div>;
}
