import { randomUUID } from "node:crypto";
import path from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { parseDocument } from "./documents";
import { publicUrl, readPublicPage, readPublicResponse } from "./public-web";
import type { PageText } from "./types";

export type WebAttachment = { title: string; url: string; pdf: boolean };
export type WebCapture = { captureId: string; title: string; sourceUrl: string; text: string; pageCount: number; method: "html" | "browser" | "pdf"; warnings: string[]; attachments: WebAttachment[] };
type CapturedDocument = WebCapture & { pages: PageText[]; fileName: string; expiresAt: number };
// Next 的多个路由共享快照；仅存在本机内存，十分钟后失效，最多保留八份。
const state = globalThis as typeof globalThis & { shenbaotongCaptures?: Map<string, CapturedDocument>; shenbaotongCrawls?: number };
const captures = state.shenbaotongCaptures ??= new Map();
export function saveCapture(input: Omit<CapturedDocument, "captureId" | "expiresAt">): WebCapture {
  for (const [key, value] of captures) if (value.expiresAt < Date.now()) captures.delete(key);
  while (captures.size >= 8) captures.delete(captures.keys().next().value!);
  const record = { ...input, captureId: randomUUID(), expiresAt: Date.now() + 10 * 60_000 };
  captures.set(record.captureId, record);
  const { pages: _pages, fileName: _file, expiresAt: _expires, ...preview } = record;
  return preview;
}
export function getCapture(id: string) {
  const record = captures.get(id);
  if (!record || record.expiresAt < Date.now()) { captures.delete(id); throw new Error("抓取预览已过期或服务已重启，请重新抓取后入库。"); }
  return record;
}

function cleanText(text: string) { return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
function nodeText(node: Node): string {
  if (node.nodeType === 3) return node.textContent?.replace(/[\r\n\t ]+/g, " ") ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as Element, tag = element.tagName;
  if (tag === "BR") return "\n";
  if (tag === "TR") return "\n" + Array.from(element.children).map(cell => cleanText(nodeText(cell))).join(" | ") + "\n";
  const text = Array.from(node.childNodes).map(nodeText).join("");
  return /^(P|DIV|SECTION|ARTICLE|MAIN|H[1-6]|LI|UL|OL|TABLE|BLOCKQUOTE|PRE)$/.test(tag) ? `\n${text}\n` : text;
}
export function extractWebpage(html: string, source: string, wholePage = false) {
  const dom = new JSDOM(html, { url: source });
  try {
    const doc = dom.window.document;
    const title = cleanText(doc.querySelector("h1")?.textContent || doc.title || "网页资料").slice(0, 160);
    const attachments: WebAttachment[] = [];
    for (const link of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      try {
        const url = publicUrl(link.href);
        if (/\.(pdf|docx?|xlsx?|zip|rar)(?:$|[?#])/i.test(url.href) && !attachments.some(a => a.url === url.href)) attachments.push({ title: cleanText(link.textContent || path.basename(url.pathname)).slice(0, 160), url: url.href, pdf: /\.pdf(?:$|[?#])/i.test(url.href) });
      } catch { /* javascript、登录和内网附件不作为来源 */ }
    }
    const known = doc.querySelector(".v_news_content, #vsb_content, #vsb_content_2, .article-content, .news-content, .articleContent, .content_detail, .notice-details .content");
    const article = known ? null : new Readability(doc.cloneNode(true) as Document, { charThreshold: 80 }).parse();
    const articleContainer = doc.createElement("div");
    if (article?.content) articleContainer.innerHTML = article.content;
    const selected = known ?? (wholePage ? doc.querySelector("main, [role='main'], article") ?? doc.body : doc.querySelector("main, [role='main'], article") ?? (article?.content ? articleContainer : doc.body));
    selected.querySelectorAll("script, style, noscript, nav, header, footer, aside, form, button, svg, iframe").forEach(el => el.remove());
    const text = cleanText(nodeText(selected));
    if (text.length > 1_000_000) throw new Error("网页正文过长，请分段导入。");
    const warnings: string[] = [];
    if (selected.querySelector("td[rowspan], th[rowspan], td[colspan], th[colspan]")) warnings.push("页面包含合并单元格，入库前请对照原网页核对表格字段。");
    if (text.length < 100) warnings.push("网页正文较少，完整通知可能位于附件中；可继续抓取下方 PDF 附件。");
    if (selected.querySelectorAll("img").length && text.length < 300) warnings.push("页面可能以图片展示内容，图片文字尚未自动识别。");
    let resolvedTitle = article?.title?.trim().slice(0, 160) || title;
    const firstLine = text.split("\n").find(line => line.trim())?.trim() || "";
    if (/通知详情|详情页/.test(resolvedTitle) && firstLine.length <= 160 && /章程|通知|规则|规程|大赛/.test(firstLine)) resolvedTitle = firstLine;
    return { title: resolvedTitle, text, attachments: attachments.slice(0, 40), warnings, hasArticle: !!known || !!doc.querySelector("article") };
  } finally { dom.window.close(); }
}

function decodeHtml(bytes: Buffer, type: string) {
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1] || /charset\s*=\s*["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString("ascii"))?.[1] || "utf-8";
  try { return new TextDecoder(charset).decode(bytes); } catch { throw new Error("网页使用了无法识别的编码，请改为粘贴正文。"); }
}

async function renderPublicPage(source: string, signal: AbortSignal) {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(process.env.RAG_DATA_DIR || "./data", "browser-runtime");
  const { chromium } = await import("playwright");
  let browser;
  try { browser = await chromium.launch({ headless: true, timeout: 15_000 }); }
  catch { throw new Error("动态网页读取组件尚未准备，请在项目目录运行 npm run setup:crawler 后重试。"); }
  const abort = () => { void browser.close(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    await context.routeWebSocket("**/*", socket => socket.close());
    let requests = 0, bytes = 0, mainError = "";
    await context.route("**/*", async route => {
      const request = route.request();
      try {
        if (++requests > 100 || bytes > 30 * 1024 * 1024 || signal.aborted) return await route.abort();
        if (request.method() !== "GET" || ["image", "media", "font"].includes(request.resourceType())) return await route.abort();
        const response = await readPublicResponse(request.url(), signal);
        bytes += response.bytes.length;
        if (request.isNavigationRequest() && request.frame().parentFrame() === null && response.status >= 400) mainError = `网站返回 ${response.status}，无法读取正文。`;
        await route.fulfill({ status: response.status, headers: response.headers, body: response.bytes });
      } catch (error) {
        if (request.isNavigationRequest() && request.frame().parentFrame() === null) mainError = safeCrawlError(error);
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    await page.goto(source, { waitUntil: "domcontentloaded", timeout: 25_000 });
    if (mainError) throw new Error(mainError);
    // 等待异步正文稳定；整次抓取仍受四十五秒总时限限制。
    let previous = "", stable = 0;
    for (let attempt = 0; attempt < 16; attempt++) {
      signal.throwIfAborted();
      const current = await page.locator("body").textContent({ timeout: 2000 }) || "";
      stable = current === previous ? stable + 1 : 0; previous = current;
      if (attempt >= 4 && current.length > 120 && stable >= 3) break;
      await page.waitForTimeout(500);
    }
    publicUrl(page.url());
    return { html: await page.content(), url: page.url() };
  } catch (error) { throw new Error(signal.aborted ? "动态网页读取超时，请重试或粘贴正文。" : safeCrawlError(error)); }
  finally { signal.removeEventListener("abort", abort); await browser.close(); }
}
export function safeCrawlError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/[\u4e00-\u9fff]/.test(message)) return message;
  if (/CERT|certificate|SSL|TLS/i.test(message)) return "网站证书校验失败，请改用上传文件或粘贴正文。";
  if (/timeout|aborted|abort|Timeout/i.test(message)) return "网页读取超时，请稍后重试。";
  return "无法读取该公开网页，请检查网址或改用上传文件、粘贴正文。";
}

export async function captureWebpage(value: string, dynamic = false): Promise<WebCapture> {
  publicUrl(value);
  if ((state.shenbaotongCrawls ?? 0) >= 2) throw new Error("正在抓取其他网页，请稍后重试。");
  state.shenbaotongCrawls = (state.shenbaotongCrawls ?? 0) + 1;
  const signal = AbortSignal.timeout(45_000);
  try {
    const response = await readPublicPage(value, signal);
    const type = response.headers["content-type"] ?? "";
    if (response.bytes.subarray(0, 5).toString() === "%PDF-") {
      const pages = await parseDocument(response.bytes, "抓取附件.pdf");
      const fileName = decodeURIComponent(path.basename(new URL(response.url).pathname)) || "抓取附件.pdf";
      return saveCapture({ title: fileName.replace(/\.pdf$/i, "").slice(0, 160), sourceUrl: response.url, text: pages.map(p => `【第${p.page}页】\n${p.text}`).join("\n\n"), pages, fileName, pageCount: pages.length, method: "pdf", warnings: [], attachments: [] });
    }
    if (!/text\/html|application\/xhtml/i.test(type) && !/^\s*(<!doctype|<html)/i.test(response.bytes.subarray(0, 512).toString())) throw new Error("该网址没有返回 HTML 网页或含文字的 PDF，其他附件请下载后导入。");
    let html = decodeHtml(response.bytes, type), sourceUrl = response.url;
    let article = extractWebpage(html, sourceUrl);
    let method: WebCapture["method"] = "html";
    const spa = !!new URL(value).hash || /<(?:div|main)[^>]*id=["'](?:app|root|__next)["']/i.test(html);
    if (dynamic || (spa && !article.hasArticle) || (!article.hasArticle && article.text.length < 600 && !article.attachments.length && /<script/i.test(html))) {
      const rendered = await renderPublicPage(value, signal);
      html = rendered.html; sourceUrl = rendered.url;
      article = extractWebpage(html, sourceUrl, true); method = "browser";
    }
    if (!article.text.trim()) throw new Error("未读取到网页正文，可能需要登录、验证码或图片识别。请上传原始文件或粘贴正文。");
    if (article.text.length < 100 && !article.attachments.length) throw new Error("未提取到足够的通知正文；可勾选动态网页重新抓取，或粘贴正文。");
    const { hasArticle: _has, ...content } = article;
    return saveCapture({ ...content, sourceUrl, method, pageCount: 0, pages: [{ page: null, text: article.text }], fileName: "抓取网页.txt" });
  } catch (error) { throw new Error(safeCrawlError(error)); }
  finally { state.shenbaotongCrawls = Math.max(0, (state.shenbaotongCrawls ?? 1) - 1); }
}
