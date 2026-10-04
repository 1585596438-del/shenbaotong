import { NextResponse } from "next/server";

export function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "请求处理失败，请重试。" }, { status });
}

// 首期只服务本地工作区。浏览器跨站请求不能借用本地模型额度或写入资料。
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // 本机命令行导入没有Origin头。
  try {
    const source = new URL(origin);
    const host = request.headers.get("host") || new URL(request.url).host;
    // Next的内部request.url可能使用localhost；以真实Host比较端口和主机。
    if (source.host !== host || !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname) || !["http:", "https:"].includes(source.protocol)) throw new Error("invalid");
  } catch { throw new Error("仅允许从本地工作台发起此操作。"); }
}

export function textField(value: unknown, name: string, maxLength = 200, required = false) {
  if (value !== undefined && value !== null && typeof value !== "string") throw new Error(`${name}格式不正确。`);
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new Error(`请填写${name}。`);
  if (text.length > maxLength) throw new Error(`${name}不能超过${maxLength}字。`);
  return text;
}

export function sourceUrl(value: unknown) {
  const text = textField(value, "来源网址", 2000);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid");
    return url.href;
  } catch { throw new Error("来源网址须为完整的http或https网址；无公开网址时可留空。"); }
}
