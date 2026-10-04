import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { checkOrigin, errorResponse, sourceUrl, textField } from "@/server/http";
import { MAX_FILE_BYTES, parseDocument } from "@/server/documents";
import { ApiProvider } from "@/server/provider";
import { indexDocument } from "@/server/rag";
import type { DocumentKind } from "@/server/types";
import { getCapture } from "@/server/webpages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ documents: getStore().listDocuments() }); }
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (Number(request.headers.get("content-length")) > MAX_FILE_BYTES + 100_000) throw new Error("单次上传不能超过10MB。");
    const form = await request.formData();
    const title = textField(form.get("title"), "文档标题", 160, true);
    const kind = textField(form.get("kind"), "资料类型", 20, true) as DocumentKind;
    if (!["catalog", "policy", "notice", "rule"].includes(kind)) throw new Error("资料类型不正确。");
    const file = form.get("file");
    const pasted = textField(form.get("text"), "正文", 1_000_000);
    const captureId = textField(form.get("captureId"), "抓取预览", 80);
    if (captureId && (pasted || (file instanceof File && file.size))) throw new Error("网页抓取不能同时上传文件或粘贴正文。");
    const captured = captureId ? getCapture(captureId) : null;
    if (file instanceof File && file.size && pasted) throw new Error("请选择上传文件或粘贴正文其中一种方式。");
    const uploaded = file instanceof File && file.size > 0;
    const pages = captured?.pages ?? (uploaded ? await parseDocument(new Uint8Array(await file.arrayBuffer()), file.name) : [{ page: null, text: pasted }]);
    const store = getStore();
    const result = store.importDocument({ title, kind, pages,
      sourceUrl: captured?.sourceUrl ?? sourceUrl(form.get("sourceUrl")), year: textField(form.get("year"), "年份", 40),
      stage: textField(form.get("stage"), "阶段", 80), competition: textField(form.get("competition"), "赛事名称", 160),
      fileName: captured?.fileName ?? (uploaded ? file.name : "粘贴正文.txt"),
    });
    const warnings: string[] = [];
    const provider = new ApiProvider();
    if (provider.embeddingReady && (!result.duplicate || result.document.embeddingKey !== provider.embeddingKey)) {
      try { result.document = await indexDocument(result.document.id, store, provider); }
      catch { warnings.push("正文已保存，但向量索引未完成。可在资料库中重新建立索引。"); }
    }
    return NextResponse.json({ ...result, warnings }, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return errorResponse(error); }
}
