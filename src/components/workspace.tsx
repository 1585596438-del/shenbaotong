"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Answer, Citation, KnowledgeDocument, Chunk } from "@/server/types";
import type { WebCapture } from "@/server/webpages";

type Status = { documents: KnowledgeDocument[]; answers: Answer[]; model: { chatReady: boolean; embeddingReady: boolean; chatModel: string; embeddingModel: string; embeddingKey: string } };
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
  const [tab, setTab] = useState<"chat" | "library" | "settings">("chat");
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
  const [preview, setPreview] = useState<Detail | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [indexing, setIndexing] = useState<string | null>(null);
  const documents = status?.documents ?? [];
  const answers = status?.answers ?? [];
  const answer = answers.find(a => a.id === activeAnswer) ?? answers.at(-1);

  async function refresh() {
    const current = await api<Status>("/api/status");
    setStatus(current);
    setSelected(ids => ids.filter(id => current.documents.some(d => d.id === id)));
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
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
      if (event.key === "Escape" && !uploading && !crawling) { setImporting(false); setPreview(null); }
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
    if (!question.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ answer: Answer }>("/api/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, documentIds: selected }) });
      setStatus(old => old ? { ...old, answers: [...old.answers.slice(-29), result.answer] } : old);
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
      setImporting(false); setTab("library");
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
    try {
      const result = await api<{ document: Detail }>(`/api/documents/${id}`);
      setPreview(result.document); setHighlight(chunkId ?? null);
      if (chunkId) setTimeout(() => document.getElementById(`source-${chunkId}`)?.scrollIntoView({ block: "center" }), 100);
    } catch (e) { setError(e instanceof Error ? e.message : "原文加载失败。"); }
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

  return <div className="workspace">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="申报通知识库首页"><span className="brand-mark">申</span><span>申报通<small>校园竞赛知识库</small></span></a>
      <nav aria-label="工作台导航">{(["chat", "library", "settings"] as const).map(t => <button className={tab === t ? "nav-item active" : "nav-item"} key={t} onClick={() => setTab(t)}><Icon name={t === "library" ? "book" : t} />{({ chat: "知识问答", library: "资料库", settings: "运行设置" })[t]}{t === "library" && <span className="count">{documents.length}</span>}</button>)}</nav>
      <div className="scope-heading"><span>本次检索范围</span><button onClick={() => setSelected([])} disabled={!selected.length}>重置</button></div>
      <label className="scope-all"><input type="checkbox" checked={!selected.length} onChange={() => setSelected([])} />全部资料 <span>{documents.length}</span></label>
      <div className="scope-list">{documents.map(doc => <label className={selected.includes(doc.id) ? "scope-doc checked" : "scope-doc"} key={doc.id}><input type="checkbox" checked={selected.includes(doc.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, doc.id] : ids.filter(id => id !== doc.id))} /><span>{doc.title}<small>{doc.year || "年份未标注"} · {kinds[doc.kind]}</small></span></label>)}{!documents.length && <p className="sidebar-empty">导入资料后，可以选择只在指定文档中查找。</p>}</div>
      <div className="sidebar-bottom"><span className="local-dot" />本地工作区<small>资料保存在本机</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">工作台 <span>/</span> {({ chat: "知识问答", library: "资料库", settings: "运行设置" })[tab]}</div><button className="primary small" onClick={() => { setError(""); setImporting(true); }}><Icon name="plus" />导入资料</button></header>
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">SHENBAOTONG / KNOWLEDGE</p><h1>{({ chat: "让每个答案，都有出处。", library: "从原始资料，建立知识。", settings: "连接模型，开启引用问答。" })[tab]}</h1><p>{tab === "chat" ? "查目录、读政策、找要求。答案与原文放在一起核对。" : tab === "library" ? "按年度和阶段收集资料，保留每个片段的页码与来源。" : "配置仅在服务端读取，认证信息不会传到浏览器。"}</p></div><span className="mode-badge"><span className="local-dot" />{status?.model.chatReady ? "文本模型已配置" : "原文检索模式"}</span></div>
        {error && <div className="alert error" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError("")}>×</button></div>}
        {notice && <div className="alert success" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
        {!status && !error && <p className="loading" role="status">正在加载本地知识库…</p>}
        {tab === "chat" && <div className="chat-grid">
          <section className="chat-panel" aria-label="知识问答">
            <div className="panel-heading"><h2>知识问答</h2><span>{selected.length ? `已选择 ${selected.length} 份资料` : `全部 ${documents.length} 份资料`}</span></div>
            {!answers.length ? <div className="chat-empty"><span className="empty-mark"><Icon name="chat" /></span><h2>{documents.length ? "从一个具体问题开始" : "先放入你的第一份资料"}</h2><p>{documents.length ? "先查找原文，再根据证据作答。通知中的年份和阶段，需要分别核对。" : "上传竞赛目录、学校管理办法或比赛通知，建立可以查证的知识库。"}</p>{!documents.length ? <button className="outline" onClick={() => setImporting(true)}>导入 PDF / TXT / Markdown</button> : <div className="suggestions">{["中国大学生计算机设计大赛", "B类竞赛如何认定", "B类竞赛的省分赛如何分类"].map(q => <button key={q} onClick={() => setQuestion(q)}>{q}<span>↗</span></button>)}</div>}</div> : <div className="conversation">{answers.map(a => <article className={`answer-item ${answer?.id === a.id ? "selected" : ""}`} key={a.id}><div className="question-line"><span>你</span><p>{a.question}</p></div><div className="answer-body"><div className="answer-meta"><strong>申报通</strong><span>{a.mode === "generated" ? "引用问答" : a.mode === "extractive" ? "原文检索" : "未找到依据"}</span></div><p>{a.answer}</p>{a.warnings.length > 0 && <div className="answer-warning">{a.warnings.join(" ")}</div>}<button className="citation-link" onClick={() => setActiveAnswer(a.id)}>{a.citations.length ? `查看 ${a.citations.length} 条原文依据` : "本次没有引用"}<span>{a.retrievalMode === "hybrid" ? "混合检索" : "关键词检索"} · {(a.elapsedMs / 1000).toFixed(1)}秒</span></button></div></article>)}{busy && <p className="loading" role="status">正在检索资料并核对引用…</p>}</div>}
            <form className="composer" onSubmit={ask}><label className="sr-only" htmlFor="question">输入问题</label><textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={1000} placeholder="例如：B类竞赛的省分赛如何认定？" rows={3} disabled={busy} /><div className="composer-footer"><span>{documents.length ? "仅依据知识库资料回答" : "请先导入资料"}</span><button className="primary" type="submit" disabled={busy || !question.trim() || !documents.length}>{busy ? "检索中…" : "发送"}<Icon name="arrow" /></button></div></form>
          </section>
          <aside className="evidence-panel" aria-label="原文依据"><div className="panel-heading"><h2>原文依据</h2><span>{answer?.citations.length ?? 0} 条</span></div>{answer && <p className="evidence-question">对应问题：{answer.question}</p>}{answer?.citations.length ? answer.citations.map(evidence) : <div className="evidence-empty"><Icon name="book" /><p>提问后，在这里查看来源、页码与原文片段。</p><small>未收录的信息不会补写成答案。</small></div>}</aside>
        </div>}
        {tab === "library" && <section className="library"><div className="library-summary"><div><strong>{documents.length}</strong><span>份来源文档</span></div><div><strong>{documents.reduce((n, d) => n + d.chunkCount, 0)}</strong><span>个原文片段</span></div><div><strong>{documents.reduce((n, d) => n + d.indexedCount, 0)}</strong><span>个向量片段</span></div></div><div className="section-heading"><h2>来源文档</h2><span>同内容、同来源和同年度的资料自动去重</span></div>{!documents.length && <div className="library-empty"><h2>资料库还是空的</h2><p>先导入真实资料，再验证问题与出处。</p><button className="primary" onClick={() => setImporting(true)}>导入第一份资料</button></div>}{documents.map(doc => {
          const ready = doc.indexedCount === doc.chunkCount && doc.embeddingKey === status?.model.embeddingKey;
          return <article className="document-row" key={doc.id}><span className="document-icon"><Icon name="book" /></span><div className="document-info"><div className="document-labels"><span>{kinds[doc.kind]}</span><span>{doc.year || "年份未标注"}</span>{doc.stage && <span>{doc.stage}</span>}</div><h3>{doc.title}</h3><p>{doc.pageCount ? `${doc.pageCount} 页 · ` : ""}{doc.chunkCount} 个片段 · {doc.characterCount.toLocaleString()} 字符 <span className={ready ? "index-state ready" : "index-state"}>{ready ? "向量索引就绪" : doc.indexedCount ? "需要重新索引" : "可用原文检索"}</span></p></div><div className="document-actions"><button className="outline small" onClick={() => openSource(doc.id)}>查看原文</button><button className="text-button" disabled={indexing !== null || !status?.model.embeddingReady} onClick={() => index(doc)} title={!status?.model.embeddingReady ? "先在运行设置中配置嵌入模型" : "重新建立此文档的向量索引"}>{indexing === doc.id ? "索引中…" : ready ? "重新索引" : "建立索引"}</button><button className="delete-button" onClick={() => removeDocument(doc)}>删除</button></div></article>;
        })}</section>}
        {tab === "settings" && <section className="settings"><div className="settings-card"><h2>当前运行状态</h2><dl><dt>文本模型</dt><dd>{status?.model.chatReady ? status.model.chatModel : "未配置 · 展示原文片段"}</dd><dt>嵌入模型</dt><dd>{status?.model.embeddingReady ? status.model.embeddingModel : "未配置 · 使用关键词检索"}</dd><dt>数据保存</dt><dd>本机 SQLite 数据库</dd></dl><p className="settings-note">配置状态表示参数齐全。实际连接结果会在提问和建立索引时检查。</p></div><div className="settings-card"><h2>连接模型服务</h2><p>将项目根目录的 <code>.env.example</code> 复制为 <code>.env.local</code>，在本机填写兼容接口的服务地址、密钥和模型名，然后重启服务。</p><pre>{"AI_BASE_URL=服务接口基础地址（含实际API前缀）\nAI_API_KEY=在本机填写\nAI_CHAT_MODEL=文本模型名称\n\nEMBEDDING_BASE_URL=嵌入接口基础地址\nEMBEDDING_API_KEY=在本机填写\nAI_EMBEDDING_MODEL=嵌入模型名称"}</pre><p>嵌入服务地址及密钥留空时沿用文本服务配置。配置后进入资料库，为文档建立索引。更换嵌入模型后需要重新索引。</p><button className="outline" onClick={() => refresh().catch(e => setError(e.message))}>刷新运行状态</button></div><div className="settings-card"><h2>资料与答案的边界</h2><p>目录收录、学校认定和当年比赛要求应分别查证。历史附件无法证明当前报名时间。没有公开网址的本地资料显示文档标题与页码，系统不会编造网址。</p><p>支持含文字层 PDF、TXT、Markdown 与粘贴正文。单文件最多10MB、50页；扫描件暂不支持识别。</p></div></section>}
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
    {preview && <div className="modal-backdrop"><section className="modal source-modal" role="dialog" aria-modal="true" aria-labelledby="source-title"><div className="modal-heading"><div><p className="eyebrow">ORIGINAL SOURCE</p><h2 id="source-title">{preview.title}</h2></div><button className="close-button" aria-label="关闭原文窗口" onClick={() => setPreview(null)}>×</button></div><div className="source-meta">{preview.year || "年份未标注"} · {kinds[preview.kind]} · {preview.fileName}{preview.sourceUrl && <a href={preview.sourceUrl} target="_blank" rel="noopener noreferrer">打开来源网址 ↗</a>}</div><div className="source-scroll">{preview.chunks.map(c => <article id={`source-${c.id}`} className={c.id === highlight ? "source-passage highlighted" : "source-passage"} key={c.id}><h3>{location(c)}</h3><p>{c.text}</p></article>)}</div></section></div>}
  </div>;
}
