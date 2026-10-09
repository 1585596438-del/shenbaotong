import { NextResponse } from "next/server";
import { checkOrigin } from "./http";
import { SettingsError } from "./model-settings";

export function settingsError(error: unknown) {
  return NextResponse.json({ error: error instanceof SettingsError ? error.message : "模型设置处理失败，请重试。" }, { status: error instanceof SettingsError ? 400 : 500 });
}
export async function readSettingsRequest(request: Request) {
  try { checkOrigin(request); } catch { throw new SettingsError("仅允许从本地工作台修改或测试模型配置。"); }
  if (!request.headers.get("content-type")?.includes("application/json")) throw new SettingsError("请使用JSON格式提交配置。");
  if (!request.body) throw new SettingsError("请提供模型配置。");
  const reader = request.body.getReader();
  let length = 0; const parts: Uint8Array[] = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 16384) { await reader.cancel(); throw new SettingsError("配置内容过长，请缩短后重试。"); } parts.push(value); }
    const bytes = Buffer.concat(parts);
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; } catch { throw new SettingsError("配置须为有效的JSON。"); }
  } finally { reader.releaseLock(); }
}
