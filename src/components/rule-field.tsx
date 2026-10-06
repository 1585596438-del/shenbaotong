"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Deadline, FieldPath, Material, RuleField, RuleValue } from "@/server/competitions/types";

type Props = {
  path: FieldPath;
  label: string;
  field: RuleField;
  onChange: (next: RuleField) => void;
  onConfirm: () => void;
  onConflict: () => void;
  onSelect: () => void;
  canConfirm: boolean;
  disabled: boolean;
  selected: boolean;
  onDelete?: () => void;
};

const states = { unknown: "未知", unreviewed: "待确认", confirmed: "已确认", conflict: "冲突" };
const listText = (value: RuleValue | null) => Array.isArray(value) ? value.join("，") : "";
const listKey = (value: RuleValue | null) => JSON.stringify(value);

export function RuleFieldEditor({ path, label, field, onChange, onConfirm, onConflict, onSelect, canConfirm, disabled, selected, onDelete }: Props) {
  const id = useId();
  const [rawTexts, setRawTexts] = useState(() => listText(field.value));
  const textsKey = useRef(listKey(field.value));
  const incomingKey = listKey(field.value);
  useEffect(() => {
    if (incomingKey !== textsKey.current) {
      textsKey.current = incomingKey;
      setRawTexts(listText(field.value));
    }
  }, [incomingKey, field.value]);

  const deadline: Deadline = field.kind === "date" && field.value && typeof field.value === "object" && "precision" in field.value
    ? field.value : { itemId: path.slice(path.indexOf(".") + 1), name: "", stage: "", precision: "date", value: "", timezone: "Asia/Shanghai" };
  const material: Material = field.kind === "material" && field.value && typeof field.value === "object" && "requirement" in field.value
    ? field.value : { itemId: path.slice(path.indexOf(".") + 1), name: "", stage: "", requirement: "unknown", condition: "" };

  function change(value: RuleValue | null) {
    onChange({ ...field, value });
  }
  function changeTexts(raw: string) {
    setRawTexts(raw);
    const items = raw.split(/[,，\r\n]+/).map(item => item.trim()).filter(Boolean);
    const value = items.length ? items : null;
    textsKey.current = listKey(value);
    change(value);
  }
  function unknown(checked: boolean) {
    if (checked) {
      setRawTexts("");
      textsKey.current = listKey(null);
      change(null);
    } else {
      change(field.kind === "date" ? deadline : field.kind === "material" ? material : null);
    }
  }
  const reason = field.value === null ? "请先填写字段值。" : path.startsWith("tags.") ? "确认建议标签需要填写维护者说明。" : "确认规则需要先绑定原文依据。";

  return <div className={`rule-editor-field${selected ? " selected" : ""}`} onFocusCapture={() => { if (!disabled) onSelect(); }}>
    <div className="rule-editor-field-heading"><strong id={`${id}-label`}>{label}</strong><span className={`rule-status ${field.state}`}>{states[field.state]}</span></div>
    <fieldset disabled={disabled} aria-labelledby={`${id}-label`}>
      <label className="rule-unknown"><input type="checkbox" checked={field.value === null} onChange={event => unknown(event.target.checked)} />未知（清空字段值）</label>
      {field.kind === "text" && <label className="field">{label}<textarea rows={3} maxLength={2000} value={typeof field.value === "string" ? field.value : ""} onChange={event => change(event.target.value.trim() ? event.target.value : null)} /></label>}
      {field.kind === "texts" && <label className="field">{label}（逗号或换行分隔）<textarea rows={3} value={rawTexts} onChange={event => changeTexts(event.target.value)} /><small>清空表示未知；没有限制时请明确填写“不限”。</small></label>}
      {field.kind === "integer" && <label className="field">{label}<input type="number" step={1} min={path === "school.basisYear" ? 2000 : 0} max={path === "school.basisYear" ? 2100 : 1000} value={typeof field.value === "number" ? field.value : ""} onChange={event => change(event.target.value === "" ? null : Number(event.target.value))} /></label>}
      {field.kind === "boolean" && <label className="field">{label}<select value={field.value === true ? "yes" : field.value === false ? "no" : "unknown"} onChange={event => change(event.target.value === "unknown" ? null : event.target.value === "yes")}><option value="unknown">未知</option><option value="yes">是</option><option value="no">否</option></select></label>}
      {field.kind === "date" && <>
        <div className="form-row"><label className="field">截止事项<input maxLength={160} value={deadline.name} onChange={event => change({ ...deadline, name: event.target.value })} /></label><label className="field">适用阶段<input maxLength={160} value={deadline.stage} onChange={event => change({ ...deadline, stage: event.target.value })} /></label></div>
        <div className="form-row"><label className="field">日期精度<select value={deadline.precision} onChange={event => { const precision = event.target.value as Deadline["precision"]; change({ ...deadline, precision, value: precision === "date" ? deadline.value.slice(0, 10) : "" }); }}><option value="date">仅日期</option><option value="datetime">具体时刻</option></select></label>
          <label className="field">{deadline.precision === "date" ? "截止日期" : "截止时刻（北京时间）"}<input type={deadline.precision === "date" ? "date" : "datetime-local"} step={deadline.precision === "datetime" ? 1 : undefined} value={deadline.precision === "date" ? deadline.value : deadline.value.replace(/\+08:00$/, "")} onChange={event => { const raw = event.target.value; change({ ...deadline, value: deadline.precision === "datetime" && raw ? `${raw.length === 16 ? `${raw}:00` : raw}+08:00` : raw }); }} /></label></div>
        <p className="rule-note">北京时间（Asia/Shanghai）。仅有日期时保留日期，不推断截止时刻。</p>
      </>}
      {field.kind === "material" && <>
        <div className="form-row"><label className="field">材料名称<input maxLength={160} value={material.name} onChange={event => change({ ...material, name: event.target.value })} /></label><label className="field">适用阶段<input maxLength={160} value={material.stage} onChange={event => change({ ...material, stage: event.target.value })} /></label></div>
        <label className="field">提交要求<select value={material.requirement} onChange={event => change({ ...material, requirement: event.target.value as Material["requirement"] })}><option value="unknown">未知</option><option value="required">必需</option><option value="optional">可选</option></select></label>
        <label className="field">材料条件<textarea rows={2} maxLength={2000} value={material.condition} onChange={event => change({ ...material, condition: event.target.value })} /></label>
      </>}
      <label className="field">{path.startsWith("tags.") ? "维护者说明（确认标签必填）" : "字段说明"}<textarea rows={2} maxLength={2000} value={field.note} onChange={event => onChange({ ...field, note: event.target.value })} /></label>
      <div className="competition-actions"><button type="button" className="outline small" aria-pressed={selected} onClick={onSelect}>{selected ? "正在核对依据" : "选择原文依据"}</button><button type="button" className="outline small" disabled={!canConfirm || field.state === "confirmed"} aria-describedby={!canConfirm ? `${id}-reason` : undefined} onClick={onConfirm}>{field.state === "confirmed" ? "已确认" : "确认字段"}</button><button type="button" className="outline small" disabled={field.value === null || !field.note.trim() || field.state === "conflict"} onClick={onConflict}>{field.state === "conflict" ? "已标记冲突" : "标记冲突"}</button>{onDelete && <button type="button" className="delete-button" aria-label={`删除${label}`} onClick={onDelete}>删除此项</button>}</div>
      <p className="rule-note">原文存在矛盾时，保留双方依据并填写说明，再标记冲突；系统不会替你选择结论。</p>
      {!canConfirm && <p className="rule-note" id={`${id}-reason`}>{reason}</p>}
    </fieldset>
  </div>;
}
