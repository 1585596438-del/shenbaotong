import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type ProviderConfig = { baseUrl: string; apiKey: string; chatModel: string; embeddingBaseUrl: string; embeddingApiKey: string; embeddingModel: string };
export class SettingsError extends Error {}
const fields = ["baseUrl", "apiKey", "chatModel", "embeddingBaseUrl", "embeddingApiKey", "embeddingModel"] as const;
function configFile() { return path.join(path.resolve(process.env.RAG_DATA_DIR || "data"), "model-settings.json"); }
export function readModelSettings(): ProviderConfig {
  const defaults = { baseUrl: process.env.AI_BASE_URL?.trim() || "", apiKey: process.env.AI_API_KEY?.trim() || "", chatModel: process.env.AI_CHAT_MODEL?.trim() || "", embeddingBaseUrl: process.env.EMBEDDING_BASE_URL?.trim() || "", embeddingApiKey: process.env.EMBEDDING_API_KEY?.trim() || "", embeddingModel: process.env.AI_EMBEDDING_MODEL?.trim() || "" };
  if (!existsSync(configFile())) return defaults;
  try {
    const saved = JSON.parse(readFileSync(configFile(), "utf8"));
    if (!saved || fields.some(key => typeof saved[key] !== "string")) throw new Error();
    return Object.fromEntries(fields.map(key => [key, saved[key]])) as ProviderConfig;
  } catch { throw new SettingsError("本机模型配置无法读取，请检查配置文件后重试。"); }
}
export function publicModelSettings(config = readModelSettings()) {
  return { baseUrl: config.baseUrl, chatModel: config.chatModel, hasApiKey: !!config.apiKey, embeddingBaseUrl: config.embeddingBaseUrl, embeddingModel: config.embeddingModel, hasEmbeddingApiKey: !!config.embeddingApiKey, embeddingEnabled: !!config.embeddingModel, embeddingUseChat: !config.embeddingBaseUrl && !config.embeddingApiKey };
}
function text(value: unknown, label: string, max = 2000) {
  if (typeof value !== "string" || value.length > max || /[\r\n\u0000]/.test(value)) throw new SettingsError(`${label}格式不正确。`);
  return value.trim();
}
function url(value: unknown, label: string) {
  const input = text(value, label);
  try {
    const parsed = new URL(input);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    if (/\/(?:chat\/completions|embeddings)\/?$/.test(parsed.pathname)) throw new Error();
    return parsed.href.replace(/\/+$/, "");
  } catch { throw new SettingsError(`${label}须为HTTPS基础地址（本机服务可用HTTP），不要包含密钥、查询参数或/chat/completions、/embeddings后缀。`); }
}
function changedOrigin(before: string, after: string) {
  try { return new URL(before).origin !== new URL(after).origin; } catch { return true; }
}
export function prepareModelSettings(input: unknown, previous = readModelSettings()): ProviderConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SettingsError("请提供模型配置。");
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => ![...fields, "embeddingEnabled", "embeddingUseChat", "target"].includes(key as typeof fields[number])) || typeof data.embeddingEnabled !== "boolean" || typeof data.embeddingUseChat !== "boolean") throw new SettingsError("配置字段不正确。");
  const baseUrl = url(data.baseUrl, "聊天API地址");
  const chatModel = text(data.chatModel, "聊天模型名称", 200);
  const newKey = text(data.apiKey, "聊天API密钥");
  if (!chatModel) throw new SettingsError("请填写聊天模型名称。");
  if (!newKey && changedOrigin(previous.baseUrl, baseUrl)) throw new SettingsError("更换聊天服务地址后，请填写该服务的密钥；不会把原密钥发送给新服务。");
  const apiKey = newKey || previous.apiKey;
  if (!apiKey) throw new SettingsError("请填写聊天API密钥。");
  if (!data.embeddingEnabled) return { baseUrl, chatModel, apiKey, embeddingBaseUrl: "", embeddingApiKey: "", embeddingModel: "" };
  const embeddingModel = text(data.embeddingModel, "嵌入模型名称", 200);
  if (!embeddingModel) throw new SettingsError("请填写嵌入模型名称，或关闭向量检索配置。");
  if (data.embeddingUseChat) return { baseUrl, chatModel, apiKey, embeddingBaseUrl: "", embeddingApiKey: "", embeddingModel };
  const embeddingBaseUrl = url(data.embeddingBaseUrl, "嵌入API地址");
  const newEmbeddingKey = text(data.embeddingApiKey, "嵌入API密钥");
  const oldEmbeddingUrl = previous.embeddingBaseUrl || previous.baseUrl;
  if (!newEmbeddingKey && changedOrigin(oldEmbeddingUrl, embeddingBaseUrl)) throw new SettingsError("更换嵌入服务地址后，请填写该服务的密钥。");
  const embeddingApiKey = newEmbeddingKey || previous.embeddingApiKey || (changedOrigin(baseUrl, embeddingBaseUrl) ? "" : apiKey);
  if (!embeddingApiKey) throw new SettingsError("请填写嵌入API密钥。");
  return { baseUrl, chatModel, apiKey, embeddingBaseUrl, embeddingApiKey, embeddingModel };
}
export function saveModelSettings(config: ProviderConfig) {
  const file = configFile(), temporary = `${file}.${randomUUID()}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true });
  try { writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" }); renameSync(temporary, file); }
  catch { throw new SettingsError("模型配置保存失败，原配置未更改。请检查本机目录权限。"); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
