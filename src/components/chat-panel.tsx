"use client";

import { useEffect, useRef, type FormEvent } from "react";
import type { Answer } from "@/server/types";

type Props = {
  answers: Answer[]; activeAnswer?: string; question: string; busy: boolean; loading: boolean;
  documents: number; selected: number; scopeOpen: boolean; title?: string;
  onQuestion: (value: string)=>void; onAsk: (event: FormEvent)=>void;
  onScope: ()=>void; onEvidence: (id: string)=>void; onImport: ()=>void;
};

export function ChatPanel(props: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{
    if (!input.current) return;
    input.current.style.height="auto";
    input.current.style.height=`${Math.min(input.current.scrollHeight,180)}px`;
  },[props.question]);
  const empty = !props.answers.length && !props.busy;
  return <section className={`dialogue-panel ${empty ? "is-empty" : ""}`} aria-label="聊天对话">
    {!empty && <div className="dialogue-heading"><span>{props.title || "新聊天"}</span><small>答案可查看原文依据</small></div>}
    {props.loading ? <p className="chat-loading" role="status">正在打开聊天…</p> : empty ? <div className="dialogue-welcome"><div className="chat-symbol" aria-hidden="true">申</div><h1>你好，我是申报通</h1><p>{props.documents ? "关于竞赛、报名和学校政策，你想了解什么？" : "导入竞赛资料，开始有依据的对话。"}</p></div> : <div className="conversation" aria-label="对话消息">{props.answers.map(answer=><article className="chat-turn" key={answer.id}>
      <div className="user-message"><span className="sr-only">你：</span><p>{answer.question}</p></div>
      <div className="assistant-message"><span className="assistant-avatar" aria-hidden="true">申</span><div><span className="sr-only">申报通：</span><p className="message-text">{answer.answer}</p>{answer.warnings.length>0 && <p className="chat-answer-warning">{answer.warnings.join(" ")}</p>}<button className={`message-sources ${props.activeAnswer===answer.id ? "active" : ""}`} onClick={()=>props.onEvidence(answer.id)}>{answer.citations.length ? `▤ ${answer.citations.length} 条原文依据` : "没有找到原文依据"}<span>{answer.mode==="generated" ? "引用问答" : "原文检索"}</span></button></div></div>
    </article>)}{props.busy && <article className="chat-turn pending-turn"><div className="user-message"><p>{props.question}</p></div><div className="assistant-message"><span className="assistant-avatar" aria-hidden="true">申</span><p className="chat-loading" role="status"><span className="thinking-dots">•••</span> 正在查找资料并核对依据</p></div></article>}</div>}
    <div className="dialogue-input-area"><form className="chat-composer" onSubmit={props.onAsk}><label className="sr-only" htmlFor="question">输入问题</label><textarea id="question" ref={input} value={props.question} onChange={event=>props.onQuestion(event.target.value)} onKeyDown={event=>{if(event.key==="Enter" && !event.shiftKey && !event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}} maxLength={1000} rows={2} disabled={props.busy || props.loading} placeholder="给申报通发送消息" /><div className="chat-composer-tools"><button className={props.scopeOpen ? "scope-chip active" : "scope-chip"} type="button" aria-expanded={props.scopeOpen} disabled={props.busy || props.loading} onClick={props.onScope}>▤ {props.selected ? `${props.selected} 份资料` : "全部资料"}</button>{!props.documents && <button className="scope-chip" type="button" onClick={props.onImport}>＋ 导入资料</button>}<button className="chat-send" type="submit" aria-label="发送消息" disabled={props.busy || props.loading || !props.question.trim() || !props.documents}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button></div></form>{empty && props.documents>0 && <div className="chat-prompts">{["计算机设计大赛有哪些要求？","软件杯如何组队？","学校竞赛类别如何认定？"].map(question=><button key={question} disabled={props.loading} onClick={()=>{props.onQuestion(question);input.current?.focus();}}>{question}</button>)}</div>}<p className="chat-footnote">仅依据已收录资料回答，请结合原文核对 · Enter 发送，Shift + Enter 换行</p></div>
  </section>;
}
