import { NextResponse } from "next/server";
import { checkOrigin, errorResponse, textField } from "@/server/http";
import { answerQuestion } from "@/server/rag";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (Number(request.headers.get("content-length")) > 20_000) throw new Error("问题请求过大。");
    const body = await request.json() as { question?: unknown; documentIds?: unknown };
    const question = textField(body.question, "问题", 1000, true);
    if (body.documentIds !== undefined && (!Array.isArray(body.documentIds) || body.documentIds.length > 100 || body.documentIds.some(id => typeof id !== "string" || id.length > 100))) throw new Error("文档范围格式不正确。");
    const answer = await answerQuestion({ question, documentIds: body.documentIds as string[] | undefined });
    return NextResponse.json({ answer });
  } catch (error) { return errorResponse(error); }
}
