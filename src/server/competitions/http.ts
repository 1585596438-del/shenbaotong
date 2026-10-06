import { NextResponse } from "next/server";
import { checkOrigin } from "../http";
import { CompetitionError } from "./types";

const MAX_RULE_BYTES = 65536;

export function checkRuleOrigin(request: Request): void {
  try { checkOrigin(request); }
  catch { throw new CompetitionError("仅允许从本地工作台发起此操作。"); }
}

export async function readRuleJson(request: Request): Promise<unknown> {
  if (!request.body) throw new CompetitionError("请提供JSON请求正文。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RULE_BYTES) {
        // Cancel as soon as the actual stream exceeds the limit, regardless of headers.
        await reader.cancel().catch(() => undefined);
        throw new CompetitionError("请求正文不能超过65536字节（64KB）。");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof CompetitionError) throw error;
    throw new CompetitionError("请求正文须为有效的UTF-8 JSON。");
  } finally { reader.releaseLock(); }
}

export function competitionErrorResponse(error: unknown) {
  if (error instanceof CompetitionError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "竞赛规则处理失败，请重试。" }, { status: 500 });
}
