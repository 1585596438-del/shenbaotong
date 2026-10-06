"use client";

import { useEffect, useState } from "react";
import type { Chunk, KnowledgeDocument } from "@/server/types";
import type { CompetitionEvent, EvidenceInput, FieldPath, RuleSource } from "@/server/competitions/types";
import { ruleApi } from "./competition-api";

export type SourceDetail = KnowledgeDocument & { chunks: Omit<Chunk, "embedding" | "embeddingKey">[] };
type Props = { documents: KnowledgeDocument[]; event: CompetitionEvent; sources: RuleSource[]; evidence: EvidenceInput[]; fieldPath: FieldPath | null; disabled: boolean; onSourcesChange: (next: RuleSource[]) => void; onEvidenceChange: (next: EvidenceInput[]) => void; onLoaded: (next: Record<string, SourceDetail>) => void };

export function RuleSourcePicker({ documents, event, sources, evidence, fieldPath, disabled, onSourcesChange, onEvidenceChange, onLoaded }: Props) {
  const [loaded, setLoaded] = useState<Record<string, SourceDetail>>({});
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const ids = sources.map(source => source.documentId).join("|");
  useEffect(() => {
    const controller = new AbortController();
    setLoaded({}); onLoaded({}); setLoading(true); setFailed(false);
    Promise.allSettled(ids.split("|").filter(Boolean).map(id => ruleApi<{ document: SourceDetail }>(`/api/documents/${encodeURIComponent(id)}`, { signal: controller.signal }))).then(results => {
      if (controller.signal.aborted) return;
      const next: Record<string, SourceDetail> = {};
      results.forEach(result => { if (result.status === "fulfilled") next[result.value.document.id] = result.value.document; });
      setLoaded(next); onLoaded(next); setFailed(results.some(result => result.status === "rejected")); setLoading(false);
    });
    return () => controller.abort();
  }, [ids, onLoaded]);
  const activeId = sources.some(source => source.documentId === selected) ? selected : sources[0]?.documentId ?? "";
  const active = loaded[activeId];
  function editSource(id: string, patch: Partial<RuleSource>) { onSourcesChange(sources.map(source => source.documentId === id ? { ...source, ...patch } : source)); }
  return <aside className="rule-source-picker" aria-label="原文依据"><h3>适用原文与字段依据</h3><p className="muted">先选资料并核对适用范围，再为左侧选中的字段绑定原文片段。</p><fieldset disabled={disabled}><legend>选择适用资料（最多 30 份）</legend><div className="rule-source-options">{documents.map(doc => <label key={doc.id}><input type="checkbox" checked={sources.some(source => source.documentId === doc.id)} disabled={!sources.some(source => source.documentId === doc.id) && sources.length >= 30} onChange={e => onSourcesChange(e.target.checked ? [...sources, { documentId: doc.id, applicabilityNote: "", confirmed: false }] : sources.filter(source => source.documentId !== doc.id))} />{doc.title} <small>{doc.year || "年份未标明"} · {doc.stage || "阶段未标明"}</small></label>)}</div>{!documents.length && <p>没有可用原文，请先到资料库导入资料。</p>}
  {sources.map(source => {
    const doc = documents.find(doc => doc.id === source.documentId);
    const years = `${doc?.year ?? ""} ${doc?.title ?? ""}`.match(/(?:19|20)\d{2}/g)?.map(Number) ?? [];
    const mismatch = doc && doc.kind !== "catalog" && doc.kind !== "policy" && years.length > 0 && !years.some(year => year >= event.yearStart && year <= event.yearEnd);
    return <article className="rule-source-card" key={source.documentId}><strong>{doc?.title ?? "原文已不可用 · 请移除或补充"}</strong>{mismatch && <p className="rule-warning" role="status">原文年份与当前届次不相符，发布时服务端会再次校验。</p>}<label className="field">届次、赛道与阶段适用说明<textarea maxLength={500} value={source.applicabilityNote} onChange={e => editSource(source.documentId, { applicabilityNote: e.target.value, confirmed: false })} /></label><label className="rule-check"><input type="checkbox" checked={source.confirmed} disabled={!doc || !loaded[source.documentId] || !source.applicabilityNote.trim()} onChange={e => editSource(source.documentId, { confirmed: e.target.checked })} />已核对届次 / 赛道适用范围</label><button type="button" className="text-button" onClick={() => onSourcesChange(sources.filter(item => item.documentId !== source.documentId))}>移除此来源及关联依据</button></article>;
  })}
  <label className="field">查看原文<select value={activeId} onChange={e => setSelected(e.target.value)}><option value="">选择适用原文</option>{sources.map(source => <option key={source.documentId} value={source.documentId}>{documents.find(doc => doc.id === source.documentId)?.title ?? "原文已不可用"}</option>)}</select></label>
  {loading ? <p role="status">正在加载原文片段…</p> : active ? <div className="rule-chunks"><h4>{active.title}</h4><p>{active.year || "年份未标明"} · {active.stage || "阶段未标明"}</p>{active.sourceUrl && <a href={active.sourceUrl} target="_blank" rel="noopener noreferrer">来源网址 ↗</a>}<p className="muted">{fieldPath ? `当前字段：${fieldPath}` : "在左侧选择一个字段以绑定依据。"}</p>{active.chunks.map(chunk => { const bound = evidence.some(item => item.fieldPath === fieldPath && item.documentId === active.id && item.chunkId === chunk.id); return <article className="rule-chunk" key={chunk.id}><label className="rule-check"><input type="checkbox" disabled={!fieldPath} checked={bound} onChange={e => { if (!fieldPath) return; onEvidenceChange(e.target.checked ? [...evidence, { fieldPath, documentId: active.id, chunkId: chunk.id }] : evidence.filter(item => !(item.fieldPath === fieldPath && item.documentId === active.id && item.chunkId === chunk.id))); }} />{chunk.page === null ? `第 ${chunk.paragraph} 段` : `第 ${chunk.page} 页 · 第 ${chunk.paragraph} 段`} · {bound ? "已绑定依据" : "绑定此片段"}</label><p className="rule-chunk-text">{chunk.text}</p></article>; })}</div> : <p className="muted">{failed ? "部分原文无法加载，请核对资料是否仍存在；无法加载的片段不能用于确认。" : "选择适用资料后查看全文片段。"}</p>}
  {fieldPath && <div className="rule-bound-evidence"><h4>此字段已绑定的依据</h4>{evidence.filter(item => item.fieldPath === fieldPath).map(item => { const doc = loaded[item.documentId]; const chunk = doc?.chunks.find(chunk => chunk.id === item.chunkId); return <article key={`${item.documentId}-${item.chunkId}`}><strong>{doc?.title ?? "原文未加载或不可用"}</strong>{chunk && <><p>{doc.year} · {doc.stage} · {chunk.page === null ? `第 ${chunk.paragraph} 段` : `第 ${chunk.page} 页 · 第 ${chunk.paragraph} 段`}</p><p className="rule-chunk-text">{chunk.text}</p>{doc.sourceUrl && <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">来源网址 ↗</a>}</>}<button type="button" className="text-button" onClick={() => onEvidenceChange(evidence.filter(candidate => candidate !== item))}>删除此依据</button></article>; })}{!evidence.some(item => item.fieldPath === fieldPath) && <p className="muted">尚未绑定依据。</p>}</div>}
  </fieldset></aside>;
}
