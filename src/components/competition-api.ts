export class RuleApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "RuleApiError";
  }
}

export async function ruleApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new RuleApiError("未能读取响应，请重试。", response.status); }
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? data.error : null;
    throw new RuleApiError(typeof error === "string" ? error : "操作失败，请重试。", response.status);
  }
  return data as T;
}
