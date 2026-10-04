import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { checkOrigin, errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const document = getStore().getDocument(id);
  if (!document) return errorResponse(new Error("文档不存在。"), 404);
  return NextResponse.json({ document: { ...document, chunks: document.chunks.map(({ embedding: _vector, embeddingKey: _key, ...chunk }) => chunk) } });
}
export async function DELETE(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const { id } = await context.params;
    if (!getStore().getDocument(id)) return errorResponse(new Error("文档不存在。"), 404);
    getStore().deleteDocument(id);
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
