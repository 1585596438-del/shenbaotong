"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Chunk, KnowledgeDocument } from "@/server/types";
import { FIELD_DEFINITIONS } from "@/server/competitions/types";
import type { Competition, CompetitionEvent, Deadline, EventDetail, FieldPath, RuleField, RuleVersion, VersionState } from "@/server/competitions/types";
import { ruleApi, RuleApiError } from "./competition-api";

type Item = { competition: Competition; event: CompetitionEvent; current: RuleVersion | null; draft: RuleVersion | null };
type List = { competitions: Competition[]; items: Item[] };
type SourceDetail = KnowledgeDocument & { chunks: Omit<Chunk, "embedding" | "embeddingKey">[] };
type Props = { documents: KnowledgeDocument[]; onAsk: (ids: string[]) => void; onLibrary: () => void; onSource: (id: string, chunkId?: string) => void };
const states: Record<VersionState, string> = { draft: "草稿", published: "已发布", needs_review: "需重新审核", archived: "历史版本" };
const fieldStates = { unknown: "未知", unreviewed: "待确认", confirmed: "已确认", conflict: "有冲突" };
const groups = [["content", "比赛内容"], ["student", "学生要求"], ["team", "团队与教师"], ["tags", "方向标签 · 供后续参考"], ["school", "学校认定"], ["deadlines", "截止日期"], ["materials", "材料要求"]] as const;
function message(error: unknown) {
  return error instanceof RuleApiError && error.status === 409 ? `${error.message} 请重新载入并核对，当前输入已保留。` : error instanceof Error ? error.message : "操作失败，请重试。";
}
function fieldValue(field?: RuleField): string {
  const value = field?.value;
  if (value === undefined || value === null) return "未知 · 待补充";
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") {
    if ("precision" in value) return `${value.name}：${value.value.replace("T", " ").replace("+08:00", "")}（北京时间${value.precision === "date" ? "，仅日期" : ""}）${value.stage ? ` · ${value.stage}` : ""}`;
    return `${value.name} · ${{ required: "必需", optional: "可选", unknown: "要求未知" }[value.requirement]}${value.stage ? ` · ${value.stage}` : ""}${value.condition ? ` · ${value.condition}` : ""}`;
  }
  return String(value);
}
function registration(version: RuleVersion, now: Date): string {
  if (version.status === "needs_review") return "报名时间需重新核对";
  if (version.status === "archived") return "历史规则 · 报名时间仅供回溯";
  const deadlines = Object.entries(version.body.fields).filter(([path, field]) => path.startsWith("deadlines.") && field?.kind === "date" && field.state === "confirmed" && field.value && typeof field.value === "object" && "precision" in field.value && /报名.*(截止|结束)|(截止|结束).*报名/.test(field.value.name)).map(([, field]) => field!.value as Deadline);
  if (!deadlines.length) return "报名时间待确认";
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const datePart = (type: string) => parts.find(part => part.type === type)?.value;
  const today = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
  return deadlines.every(deadline => deadline.precision === "date" ? deadline.value < today : Date.parse(deadline.value) < now.getTime()) ? "已过报名日期" : "已确认报名截止 · 请核对阶段与日期";
}

export function CompetitionLibrary({ documents, onAsk, onLibrary, onSource }: Props) {
  const [list, setList] = useState<List>({ competitions: [], items: [] });
  const [competitionId, setCompetitionId] = useState("");
  const [eventId, setEventId] = useState("");
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [versionId, setVersionId] = useState("");
  const [form, setForm] = useState<"competition" | "event" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState<Record<string, SourceDetail>>({});
  const [now, setNow] = useState(() => new Date());
  const detailRequest = useRef(0);
  const activeEvent = useRef("");
  const version = detail?.versions.find(item => item.id === versionId) ?? null;
  async function reload(signal?: AbortSignal) {
    const result = await ruleApi<List>("/api/competitions", { signal });
    setList(result);
    return result;
  }
  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal).catch(e => { if (!controller.signal.aborted) setError(message(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); detailRequest.current++; };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setSources({});
    if (!version) return;
    const controller = new AbortController();
    const ids = [...new Set([...version.body.sources.map(source => source.documentId), ...version.evidence.map(evidence => evidence.documentId)])];
    Promise.allSettled(ids.map(id => ruleApi<{ document: SourceDetail }>(`/api/documents/${encodeURIComponent(id)}`, { signal: controller.signal }))).then(results => {
      if (controller.signal.aborted) return;
      const next: Record<string, SourceDetail> = {};
      results.forEach(result => { if (result.status === "fulfilled") next[result.value.document.id] = result.value.document; });
      setSources(next);
    });
    return () => controller.abort();
  }, [version]);
  function clearDetail() {
    detailRequest.current++; activeEvent.current = ""; setEventId(""); setDetail(null); setVersionId(""); setDetailLoading(false);
  }
  async function openEvent(id: string, preferred?: string) {
    const request = ++detailRequest.current;
    activeEvent.current = id; setEventId(id); setDetail(null); setVersionId(""); setDetailLoading(true); setError("");
    try {
      const result = await ruleApi<{ detail: EventDetail }>(`/api/competitions/events/${encodeURIComponent(id)}`);
      if (request !== detailRequest.current) return;
      setDetail(result.detail);
      setVersionId(preferred ?? result.detail.current?.id ?? result.detail.draft?.id ?? result.detail.versions[0]?.id ?? "");
    } catch (e) { if (request === detailRequest.current) setError(message(e)); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !form) return;
    const element = event.currentTarget;
    const values = new FormData(element);
    const get = (name: string) => String(values.get(name) ?? "").trim();
    const action = form;
    if (action === "event" && Number(get("yearStart")) > Number(get("yearEnd"))) { setError("开始年度不能晚于结束年度，输入已保留。"); return; }
    const input = action === "competition" ? { name: get("name"), aliases: get("aliases").split(/[,，\n]/).map(alias => alias.trim()).filter(Boolean), catalogNumber: get("catalogNumber") ? Number(get("catalogNumber")) : null, catalogYear: get("catalogYear") ? Number(get("catalogYear")) : null, officialUrl: get("officialUrl") } : { competitionId: get("competitionId"), editionLabel: get("editionLabel"), yearStart: Number(get("yearStart")), yearEnd: Number(get("yearEnd")), trackName: get("trackName"), stage: get("stage") };
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await ruleApi<{ competition?: Competition; event?: CompetitionEvent }>("/api/competitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, input }) });
      setForm(null);
      if (result.competition) { clearDetail(); setCompetitionId(result.competition.id); setNotice("赛事已建档，可以继续新建届次与赛道。"); }
      if (result.event) { setCompetitionId(result.event.competitionId); await openEvent(result.event.id); setNotice("赛道已建档，可以创建规则草稿。"); }
      await reload();
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  }
  async function createDraft() {
    if (!detail || saving) return;
    const id = detail.event.id;
    setSaving(true); setError("");
    try {
      const result = await ruleApi<{ version: RuleVersion }>(`/api/competitions/events/${encodeURIComponent(id)}/draft`, { method: "POST" });
      await reload();
      if (activeEvent.current === id) { await openEvent(id, result.version.id); setNotice("草稿已就绪。字段编辑、依据审核与发布将在下一阶段实现。"); }
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  }
  const availableSources = version && version.status !== "needs_review" && version.status !== "archived" ? version.body.sources.map(source => source.documentId).filter(id => documents.some(doc => doc.id === id)) : [];
  function renderField(path: FieldPath, label: string) {
    const field = version?.body.fields[path];
    return <div className="rule-read-field" key={path}><dt>{label}<span className="rule-field-state">{fieldStates[field?.state ?? "unknown"]}{version?.status === "needs_review" ? " · 依据需复核" : version?.status === "archived" ? " · 历史记录" : ""}</span></dt><dd>{fieldValue(field)}{field?.note && <p className="rule-note">说明：{field.note}</p>}{version?.evidence.filter(item => item.fieldPath === path).map(item => {
      const doc = documents.find(doc => doc.id === item.documentId);
      const chunk = sources[item.documentId]?.chunks.find(chunk => chunk.id === item.chunkId);
      return <div className="rule-evidence" key={`${item.documentId}-${item.chunkId}`}>{doc ? <button className="text-button" onClick={() => onSource(item.documentId, item.chunkId)}>查看依据 · {doc.title}{chunk ? ` · ${chunk.page === null ? `第 ${chunk.paragraph} 段` : `第 ${chunk.page} 页 · 片段 ${chunk.paragraph}`}` : " · 定位原文片段"}</button> : <span className="muted">原文已不可用 · 需重新核对</span>}</div>;
    })}</dd></div>;
  }
  return <section aria-label="竞赛规则库">
    {error && <div className="alert error" role="alert">{error}<button aria-label="关闭规则错误提示" onClick={() => setError("")}>×</button></div>}
    {notice && <div className="alert success" role="status">{notice}<button aria-label="关闭规则提示" onClick={() => setNotice("")}>×</button></div>}
    <div className="competition-toolbar"><p>按赛事、届次与赛道保存规则，逐条保留原文依据。</p><div><button className="outline small" disabled={saving || loading} onClick={() => setForm(form === "competition" ? null : "competition")}>新建赛事</button><button className="primary small" disabled={saving || loading || !list.competitions.length} onClick={() => setForm(form === "event" ? null : "event")}>新建届次与赛道</button></div></div>
    {form && <form key={form} className="competition-form" onSubmit={create}><h2>{form === "competition" ? "新建母赛事" : "新建届次与赛道"}</h2><fieldset disabled={saving}>
      {form === "competition" ? <><label className="field">赛事名称<input name="name" required maxLength={160} /></label><label className="field">别名（可选，逗号分隔）<input name="aliases" maxLength={1000} /></label><div className="form-row"><label className="field">目录编号（可选）<input name="catalogNumber" type="number" min={1} step={1} /></label><label className="field">目录年度（可选）<input name="catalogYear" type="number" min={2000} max={2100} step={1} /></label></div><label className="field">官方网站（可选）<input name="officialUrl" type="url" maxLength={2000} /></label></> : <><label className="field">所属赛事<select name="competitionId" required defaultValue={competitionId || list.competitions[0]?.id}>{list.competitions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">届次名称<input name="editionLabel" required maxLength={160} placeholder="例如：2026 年第十七届" /></label><div className="form-row"><label className="field">开始年度<input name="yearStart" type="number" required min={2000} max={2100} step={1} defaultValue={now.getFullYear()} /></label><label className="field">结束年度<input name="yearEnd" type="number" required min={2000} max={2100} step={1} defaultValue={now.getFullYear()} /></label></div><label className="field">赛道名称<input name="trackName" required maxLength={160} /></label><label className="field">比赛阶段<input name="stage" required maxLength={160} placeholder="例如：省赛" /></label></>}
      <div className="competition-actions"><button className="primary" type="submit">{saving ? "保存中…" : form === "competition" ? "保存赛事" : "保存赛道"}</button><button className="outline" type="button" onClick={() => setForm(null)}>取消</button></div></fieldset></form>}
    <div className="competition-layout"><aside className="competition-index" aria-label="赛事与赛道"><div className="panel-heading"><h2>赛事档案</h2><span>{list.competitions.length} 个赛事</span></div>{loading ? <p className="loading" role="status">正在加载赛事…</p> : !list.competitions.length ? <div className="competition-empty"><p>还没有赛事档案。没有原文也可以先建档，规则保留未知。</p><button className="outline small" onClick={() => setForm("competition")}>新建第一个赛事</button></div> : <><label className="field competition-selector">选择赛事<select value={competitionId} onChange={e => { setCompetitionId(e.target.value); clearDetail(); }}><option value="">全部赛事</option>{list.competitions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{list.competitions.filter(item => !competitionId || item.id === competitionId).map(competition => <div className="competition-group" key={competition.id}><h3>{competition.name}</h3>{list.items.filter(item => item.competition.id === competition.id).map(item => <button className={`competition-event ${eventId === item.event.id ? "active" : ""}`} key={item.event.id} aria-pressed={eventId === item.event.id} onClick={() => openEvent(item.event.id)}><strong>{item.event.trackName}</strong><span>{item.event.editionLabel} · {item.event.stage}</span><small>{item.event.yearStart === item.event.yearEnd ? item.event.yearStart : `${item.event.yearStart}–${item.event.yearEnd}`} · {item.current ? states[item.current.status] : "暂无有效发布"}{item.draft ? " · 草稿" : ""}</small></button>)}{!list.items.some(item => item.competition.id === competition.id) && <div className="competition-empty"><p>尚无届次与赛道</p><button className="text-button" onClick={() => { setCompetitionId(competition.id); setForm("event"); }}>为此赛事新建赛道</button></div>}</div>)}</>}</aside>
    <section className="competition-detail" aria-label="规则版本详情">{detailLoading ? <p className="loading" role="status">正在加载赛道详情…</p> : !detail ? <div className="competition-empty"><h2>选择一个赛道查看规则</h2><p>比赛要求按届次、赛道与阶段独立保存。规则发布表示完成资料审核，不代表参赛资格批准。</p></div> : <><div className="competition-detail-heading"><p className="eyebrow">{detail.competition.name}</p><h2>{detail.event.trackName}</h2><p>{detail.event.editionLabel} · {detail.event.yearStart}–{detail.event.yearEnd} · {detail.event.stage}</p>{detail.competition.officialUrl && <a href={detail.competition.officialUrl} target="_blank" rel="noopener noreferrer">赛事官网 ↗</a>}</div><div className="competition-version-bar"><button className="primary small" disabled={saving} onClick={() => detail.draft ? (setVersionId(detail.draft.id), setNotice("当前为只读草稿。字段编辑、依据审核与发布将在下一阶段实现。")) : createDraft()}>{saving ? "创建中…" : detail.draft ? "继续草稿" : "创建草稿"}</button><button className="outline small" disabled={!detail.current} onClick={() => detail.current && setVersionId(detail.current.id)}>查看当前发布</button>{detail.versions.length > 0 && <label className="field">规则版本<select value={versionId} onChange={e => setVersionId(e.target.value)}>{detail.versions.map(item => <option value={item.id} key={item.id}>v{item.version} · {states[item.status]}</option>)}</select></label>}</div>{!version ? <div className="competition-empty"><h3>尚无规则版本</h3><p>先创建草稿，未录入的规则显示未知。</p><button className="text-button" onClick={onLibrary}>去资料库补充原文</button></div> : <><div className="competition-version-summary"><span className={`rule-status ${version.status}`}>v{version.version} · {states[version.status]}</span><p>{registration(version, now)}</p><small>规则发布不代表参赛资格批准。{version.status === "draft" ? "当前草稿只读，字段编辑、依据审核与发布待下一阶段实现。" : version.status === "needs_review" ? "来源发生变化，已确认字段也需重新核对。" : version.status === "archived" ? "历史版本只供回溯，请核对当前发布版本。" : "请结合原文及具体比赛阶段核对。"}</small></div><section className="competition-sources" aria-label="适用来源"><h3>适用来源</h3>{!version.body.sources.length && <p className="muted">待补来源 · 当前没有关联原文</p>}{version.body.sources.map(source => {
      const doc = documents.find(doc => doc.id === source.documentId);
      return <article key={source.documentId}><strong>{doc?.title ?? "原文已不可用"}</strong><p>{source.applicabilityNote || "届次与赛道适用说明待补充"} · {source.confirmed ? "已核对适用范围" : "适用范围待确认"}</p>{doc && <div className="competition-actions"><button className="text-button" onClick={() => onSource(doc.id)}>查看原文</button>{doc.sourceUrl && <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">来源网址 ↗</a>}</div>}</article>;
    })}<div className="competition-actions"><button className="outline small" disabled={!availableSources.length} onClick={() => onAsk([...new Set(availableSources)])}>用这些原文提问</button>{!availableSources.length && <button className="text-button" onClick={onLibrary}>去资料库补充或核对原文</button>}</div></section><div className="rule-read-groups">{groups.map(([prefix, label]) => {
      const fixed = FIELD_DEFINITIONS.filter(field => field.path.startsWith(`${prefix}.`));
      const dynamic = Object.keys(version.body.fields).filter(path => path.startsWith(`${prefix}.`) && (prefix === "deadlines" || prefix === "materials")) as FieldPath[];
      return <section key={prefix}><h3>{label}</h3><dl>{fixed.map(field => renderField(field.path, field.label))}{dynamic.map(path => renderField(path, prefix === "deadlines" ? "截止事项" : "材料"))}</dl>{!fixed.length && !dynamic.length && <p className="muted">未知 · 待补充</p>}</section>;
    })}</div></>}</> }</section></div>
  </section>;
}
