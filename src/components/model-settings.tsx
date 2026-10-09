"use client";

import { useEffect, useState, type FormEvent } from "react";

type Saved = { baseUrl: string; chatModel: string; hasApiKey: boolean; embeddingBaseUrl: string; embeddingModel: string; hasEmbeddingApiKey: boolean; embeddingEnabled: boolean; embeddingUseChat: boolean };
type Form = Omit<Saved, "hasApiKey" | "hasEmbeddingApiKey"> & { apiKey: string; embeddingApiKey: string };
const presets = { zhipu: { label: "智谱", url: "https://open.bigmodel.cn/api/paas/v4" }, deepseek: { label: "DeepSeek", url: "https://api.deepseek.com" }, custom: { label: "其他兼容 API / 本机服务", url: "" } };
function providerFor(url: string) { try { const host = new URL(url).hostname; return host === "open.bigmodel.cn" ? "zhipu" : host === "api.deepseek.com" ? "deepseek" : "custom"; } catch { return "custom"; } }
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败，请重试。");
  return data;
}
export function ModelSettings({ onSaved, onEditState }: { onSaved: () => Promise<void>; onEditState: (dirty: boolean, busy: boolean) => void }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [provider, setProvider] = useState("custom");
  const [busy, setBusy] = useState<"save" | "chat" | "embedding" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onEditState(dirty, !!busy); return () => onEditState(false, false); }, [dirty, busy, onEditState]);
  function apply(value: Saved) { setSaved(value); setForm({ ...value, apiKey: "", embeddingApiKey: "" }); setProvider(providerFor(value.baseUrl)); setDirty(false); }
  useEffect(() => { let cancelled = false; request<Saved>("/api/settings").then(value => { if (!cancelled) apply(value); }).catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, []);
  useEffect(() => { const leave = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave); }, [dirty, busy]);
  function update(change: Partial<Form>) { setForm(value => value ? { ...value, ...change } : value); setDirty(true); setMessage(""); setError(""); }
  async function act(target: "save" | "chat" | "embedding") {
    if (!form || busy) return;
    setBusy(target); setError(""); setMessage("");
    const { hasApiKey: _chatKey, hasEmbeddingApiKey: _embeddingKey, ...values } = { ...form, hasApiKey: saved?.hasApiKey, hasEmbeddingApiKey: saved?.hasEmbeddingApiKey };
    try {
      if (target === "save") { const result = await request<Saved>("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }); apply(result); setMessage("已保存，后续问答立即使用此配置。当前资料和聊天保持不变。"); await onSaved(); }
      else { const result = await request<{ message: string }>("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, target }) }); setMessage(`${result.message}测试未保存配置。`); }
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试。"); }
    finally { setBusy(null); }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void act("save"); };
  return <section className="api-settings" aria-label="API 接入设置">
    <div className="settings-card api-settings-intro"><span className="api-settings-kicker">模型连接</span><h2>选择你的 API</h2><p>聊天模型负责回答，嵌入模型负责按意思查找资料。可以分别接入不同服务。</p><span className="api-local-badge">仅保存在本机 · 保存后立即生效</span></div>
    {error && <p className="api-feedback api-error" role="alert">{error}</p>}
    {message && <p className="api-feedback api-success" role="status">{message}</p>}
    {!form ? <p>{error ? "配置暂时无法加载，请刷新后重试。" : "正在读取当前配置…"}</p> : <form onSubmit={submit}>
      <fieldset disabled={!!busy} className="settings-card api-settings-fields"><legend>聊天模型</legend>
        <div className="api-form-grid"><label>服务商<select value={provider} onChange={event => { const key = event.target.value as keyof typeof presets; setProvider(key); update({ baseUrl: presets[key].url, chatModel: "", apiKey: "" }); }}><option value="zhipu">智谱</option><option value="deepseek">DeepSeek</option><option value="custom">其他兼容 API / 本机服务</option></select></label>
        <label>模型名称<input value={form.chatModel} onChange={event => update({ chatModel: event.target.value })} placeholder="填写账号可用的模型名称" maxLength={200} required /></label>
        <label className="api-wide">API 基础地址<input type="url" value={form.baseUrl} onChange={event => { setProvider(providerFor(event.target.value)); update({ baseUrl: event.target.value }); }} placeholder="https://服务地址/实际API前缀" maxLength={2000} required /><small>使用兼容的聊天接口。填基础地址，不要附加 /chat/completions。</small></label>
        <label className="api-wide">API 密钥<input type="password" autoComplete="new-password" spellCheck={false} value={form.apiKey} onChange={event => update({ apiKey: event.target.value })} placeholder={saved?.hasApiKey ? "已配置；留空保留，填写新密钥可替换" : "在这里填写密钥"} maxLength={2000} /><small>不会回显已保存的密钥。更换服务地址后需填写该服务的密钥。</small></label></div>
        <button type="button" className="outline small" onClick={() => void act("chat")}>{busy === "chat" ? "正在测试…" : "测试聊天连接"}</button>
      </fieldset>
      <fieldset disabled={!!busy} className="settings-card api-settings-fields"><legend>嵌入模型 · 可选</legend>
        <label className="api-check"><input type="checkbox" checked={form.embeddingEnabled} onChange={event => update({ embeddingEnabled: event.target.checked })} />配置向量检索</label>
        <p className="settings-note">关闭时仍可使用关键词检索和 AI 回答。启用后，还需在资料库为文档建立索引。</p>
        {form.embeddingEnabled && <><label className="api-check"><input type="checkbox" checked={form.embeddingUseChat} onChange={event => update({ embeddingUseChat: event.target.checked })} />沿用聊天服务的地址与密钥</label><div className="api-form-grid">
          <label className="api-wide">嵌入模型名称<input value={form.embeddingModel} onChange={event => update({ embeddingModel: event.target.value })} placeholder="填写支持文字嵌入的模型名称" maxLength={200} required /><small>应填写嵌入模型名称，不能直接使用聊天模型名称。</small></label>
          {!form.embeddingUseChat && <><label className="api-wide">嵌入 API 基础地址<input type="url" value={form.embeddingBaseUrl} onChange={event => update({ embeddingBaseUrl: event.target.value })} placeholder="https://服务地址/实际API前缀" maxLength={2000} required /></label><label className="api-wide">嵌入 API 密钥<input type="password" autoComplete="new-password" spellCheck={false} value={form.embeddingApiKey} onChange={event => update({ embeddingApiKey: event.target.value })} placeholder={saved?.hasEmbeddingApiKey ? "已配置；留空保留" : "填写嵌入服务的密钥"} maxLength={2000} /></label></>}
        </div><button type="button" className="outline small" onClick={() => void act("embedding")}>{busy === "embedding" ? "正在测试…" : "测试嵌入连接"}</button><p className="settings-note">更换嵌入服务或模型后，需要重新建立索引；已有原文保留。</p></>}
      </fieldset>
      <div className="api-settings-actions"><button type="submit" disabled={!!busy || !dirty}>{busy === "save" ? "正在保存…" : "保存 API 配置"}</button><button type="button" className="outline" disabled={!!busy || !dirty} onClick={() => { if (saved) apply(saved); setError(""); setMessage(""); }}>放弃修改</button><span>{dirty ? "有未保存的修改" : "当前配置已保存"}</span></div>
      <p className="settings-note">测试会调用对应模型，但不会保存配置或修改资料。密钥保存在本机配置文件中，不上传 GitHub，也不写入聊天。</p>
    </form>}
  </section>;
}
