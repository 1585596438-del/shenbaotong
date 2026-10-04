import path from "node:path";
import type { PageText } from "./types";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export async function parseDocument(bytes: Uint8Array, fileName: string): Promise<PageText[]> {
  if (bytes.length > MAX_FILE_BYTES) throw new Error("单个文件不能超过10MB。");
  const extension = path.extname(fileName).toLowerCase();
  if ([".txt", ".md"].includes(extension)) {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { try { text = new TextDecoder("gb18030", { fatal: true }).decode(bytes); } catch { throw new Error("无法识别文本编码，请另存为UTF-8文本。"); } }
    if (!text.trim()) throw new Error("文件正文为空。");
    if (text.length > 1_000_000) throw new Error("文本超过首期可处理长度，请拆分后导入。");
    return [{ page: null, text }];
  }
  if (extension !== ".pdf") throw new Error("目前支持PDF、TXT和Markdown文件，或直接粘贴正文。");
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("文件内容不是有效PDF。");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let pdf;
  try { pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true }).promise; }
  catch { throw new Error("PDF无法读取，可能已加密或损坏。请使用可复制文字的PDF。"); }
  try {
    if (pdf.numPages > 50) throw new Error("单个PDF不能超过50页。");
    const pages: PageText[] = [];
    let characters = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = content.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("");
      characters += text.length;
      if (characters > 1_000_000) throw new Error("PDF文字量超过首期处理范围，请拆分文件。");
      pages.push({ page, text });
    }
    if (!pages.some(p => p.text.trim())) throw new Error("未提取到文字，这可能是扫描PDF。请改用含文字层PDF或粘贴正文；首期尚未接入OCR。");
    return pages;
  } finally { await pdf.destroy(); }
}
