import type { Chunk, RankedChunk } from "./types";

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const stopWords = new Set(["的", "了", "吗", "呢", "我", "你", "是", "有", "和", "与", "什么", "哪些", "怎么", "如何", "是否", "可以", "请问", "这个", "多少", "参加", "比赛", "竞赛", "要求", "学校", "说明", "给出", "全国", "中国", "大学生", "大赛"]);
function normalize(text: string) { return text.toLowerCase().replace(/\s+/g, ""); }
function terms(text: string) {
  const values = [...segmenter.segment(text.toLowerCase())].filter(s => s.isWordLike).map(s => s.segment).filter(s => !stopWords.has(s) && (s.length > 1 || /^[a-z0-9]$/i.test(s)));
  for (const category of text.toLowerCase().match(/[abcd]\s*类/g) ?? []) values.push(category.replace(/\s/g, ""));
  return [...new Set(values)];
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length || [...a, ...b].some(n => !Number.isFinite(n))) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function rankChunks(question: string, chunks: Chunk[], queryVector?: number[], embeddingKey?: string): RankedChunk[] {
  const queryTerms = terms(question);
  if (!queryTerms.length && !queryVector) return [];
  const ranked = chunks.map(chunk => {
    const body = normalize(chunk.text);
    const chunkTerms = new Set(terms(chunk.text));
    const title = normalize(chunk.title);
    let hit = 0;
    for (const term of queryTerms) {
      if (chunkTerms.has(term) || (term.length > 1 && body.includes(normalize(term)))) hit++;
      else if (term.length > 1 && title.includes(normalize(term))) hit += 0.5;
      else if (term.length >= 3 && /^[\p{Script=Han}]+$/u.test(term)) {
        const bigrams = Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2));
        hit += bigrams.filter(s => body.includes(s)).length / bigrams.length * 0.5;
      }
    }
    const lexicalScore = queryTerms.length ? hit / queryTerms.length : 0;
    const vectorScore = queryVector && chunk.embedding && chunk.embeddingKey === embeddingKey ? cosineSimilarity(queryVector, chunk.embedding) : 0;
    return { ...chunk, lexicalScore, vectorScore, score: lexicalScore * 0.65 + Math.max(0, vectorScore) * 0.35 };
  });
  return ranked.filter(c => c.lexicalScore >= 0.24 || c.vectorScore >= 0.58).sort((a, b) => b.score - a.score).slice(0, 6);
}
