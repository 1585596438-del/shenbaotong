import type { ChunkDraft, PageText } from "./types";

// 不跨页、不丢弃原文；页码与段落号始终跟随片段。
export function splitPages(pages: PageText[]): ChunkDraft[] {
  const result: ChunkDraft[] = [];
  for (const page of pages) {
    const paragraphs = page.text.match(/[\s\S]+?(?:\n[ \t]*\n|$)/g)?.filter(Boolean) ?? [];
    paragraphs.forEach((text, index) => {
      const push = (part: string) => { if (part.trim()) result.push({ page: page.page, paragraph: index + 1, text: part }); };
      let buffer = "";
      const flush = () => { push(buffer); buffer = ""; };
      for (const line of text.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? []) {
        if (line.length <= 1100) {
          if (buffer.length + line.length > 1100) flush();
          buffer += line;
          continue;
        }
        flush();
        // 多列表格行整体保留，避免将赛事名和资格条件拆散。
        const tableLine = /\|.*\||\t| {2,}/.test(line);
        if (tableLine) {
          if (line.length > 4000) throw new Error(`第${page.page ?? "文本"}页存在超过4000字符的表格行，请按独立记录拆分后导入。`);
          push(line);
          continue;
        }
        // 没有行边界的长正文按字符分块，保留全部文字和代理对。
        let offset = 0;
        while (offset < line.length) {
          let end = Math.min(offset + 1100, line.length);
          const code = line.charCodeAt(end - 1);
          if (end < line.length && code >= 0xd800 && code <= 0xdbff) end--;
          push(line.slice(offset, end));
          offset = end;
        }
      }
      flush();
    });
  }
  return result;
}
