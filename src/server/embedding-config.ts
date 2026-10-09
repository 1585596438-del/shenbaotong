export const LOCAL_EMBEDDING_MODEL = "local:bge-small-zh-v1.5";
export function embeddingIssue(baseUrl: string, model: string) {
  if (!model || model === LOCAL_EMBEDDING_MODEL) return "";
  try { if (new URL(baseUrl).hostname === "open.bigmodel.cn" && /^glm-/i.test(model)) return "GLM 系列是聊天模型，不能用于向量检索。请选择本机免费嵌入模型，或使用智谱 embedding-3。"; } catch { /* 参数完整性由配置入口校验。 */ }
  return "";
}
