import { createHash } from "node:crypto";
import type { Provider } from "./types";

export type ProviderConfig = { baseUrl: string; apiKey: string; chatModel: string; embeddingBaseUrl: string; embeddingApiKey: string; embeddingModel: string };
export class ModelHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 429
      ? "模型服务繁忙或请求受限（HTTP 429），请稍后重试。"
      : `模型服务返回HTTP ${status}，请检查模型名称、认证及额度。`);
  }
}
export function readProviderConfig(): ProviderConfig {
  return {
    baseUrl: process.env.AI_BASE_URL?.trim() || "",
    apiKey: process.env.AI_API_KEY?.trim() || "",
    chatModel: process.env.AI_CHAT_MODEL?.trim() || "",
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL?.trim() || process.env.AI_BASE_URL?.trim() || "",
    embeddingApiKey: process.env.EMBEDDING_API_KEY?.trim() || process.env.AI_API_KEY?.trim() || "",
    embeddingModel: process.env.AI_EMBEDDING_MODEL?.trim() || "",
  };
}

export class ApiProvider implements Provider {
  chatReady: boolean;
  embeddingReady: boolean;
  embeddingKey: string;
  constructor(private config: ProviderConfig = readProviderConfig()) {
    this.chatReady = Boolean(config.baseUrl && config.apiKey && config.chatModel);
    this.embeddingReady = Boolean(config.embeddingBaseUrl && config.embeddingApiKey && config.embeddingModel);
    this.embeddingKey = createHash("sha256").update(`${config.embeddingBaseUrl}|${config.embeddingModel}`).digest("hex");
  }

  private async request(baseUrl: string, apiKey: string, endpoint: string, body: unknown) {
    let response: Response;
    try {
      const url = new URL(`${baseUrl.replace(/\/+$/, "")}/${endpoint}`);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid URL");
      response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: "error",
      });
    } catch { throw new Error("模型服务连接失败或超时，请检查服务地址与网络后重试。"); }
    if (!response.ok) throw new ModelHttpError(response.status);
    try { return await response.json() as Record<string, unknown>; }
    catch { throw new Error("模型服务未返回有效JSON，不能使用该结果。"); }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.embeddingReady) throw new Error("尚未配置嵌入模型。");
    const json = await this.request(this.config.embeddingBaseUrl, this.config.embeddingApiKey, "embeddings", { model: this.config.embeddingModel, input: texts });
    if (!Array.isArray(json.data) || json.data.length !== texts.length) throw new Error("嵌入服务返回的向量数量不正确。");
    const rows = json.data as { index?: number; embedding?: unknown }[];
    if (rows.some(r => !Number.isInteger(r.index)) || new Set(rows.map(r => r.index)).size !== texts.length) throw new Error("嵌入服务返回的索引不正确。");
    const sorted = [...rows].sort((a, b) => a.index! - b.index!);
    const dimension = Array.isArray(sorted[0]?.embedding) ? sorted[0].embedding.length : 0;
    if (!dimension || sorted.some((r, i) => r.index !== i || !Array.isArray(r.embedding) || r.embedding.length !== dimension || r.embedding.some(n => typeof n !== "number" || !Number.isFinite(n)) || !r.embedding.some(n => n !== 0))) throw new Error("嵌入服务返回了无效向量。");
    return sorted.map(r => r.embedding as number[]);
  }

  async generate(system: string, user: string) {
    if (!this.chatReady) throw new Error("尚未配置文本模型。");
    // 智谱免费模型直接回答，避免有限输出额度被深度思考占满。
    const zhipuFlash = /^https:\/\/open\.bigmodel\.cn(?::443)?(?:\/|$)/i.test(this.config.baseUrl) && this.config.chatModel.toLowerCase() === "glm-4.7-flash";
    const json = await this.request(this.config.baseUrl, this.config.apiKey, "chat/completions", {
      model: this.config.chatModel, temperature: 0.1, max_tokens: 1600,
      ...(zhipuFlash ? { thinking: { type: "disabled" } } : {}),
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    const choices = json.choices as { message?: { content?: unknown } }[] | undefined;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim() || content.length > 30_000) throw new Error("文本模型返回的内容无效。");
    return content;
  }
}
