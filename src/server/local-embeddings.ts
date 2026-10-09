import path from "node:path";
import { existsSync } from "node:fs";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
export const LOCAL_MODEL_REVISION = "75c43b069aac4d136ba6bc1122f995fedcfd2781";
export function localModelDirectory() { return path.resolve(process.env.RAG_DATA_DIR || "data", "models", "bge-small-zh-v1.5"); }
export function localModelReady() { return ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"].every(file => existsSync(path.join(localModelDirectory(), file))); }
const state = globalThis as typeof globalThis & { localEmbedder?: Promise<FeatureExtractionPipeline>; localEmbedderPath?: string };
async function extractor() {
  if (!localModelReady()) throw new Error("本机嵌入模型尚未下载，请先运行 npm run setup:embeddings。");
  const folder = localModelDirectory();
  if (!state.localEmbedder || state.localEmbedderPath !== folder) {
    state.localEmbedderPath = folder;
    state.localEmbedder = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowRemoteModels = false;
      const create = pipeline as unknown as (task: string, model: string, options: Record<string, unknown>) => Promise<FeatureExtractionPipeline>;
      return create("feature-extraction", folder, { device: "cpu", dtype: "q8", local_files_only: true, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
    })();
    state.localEmbedder.catch(() => { state.localEmbedder = undefined; });
  }
  return state.localEmbedder;
}
export async function localEmbed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const pipe = await extractor();
  const windows: string[] = [], owners: number[] = [];
  // 中文模型上限为512个token；分窗覆盖整个原文，而非静默截断后半段。
  texts.forEach((text, owner) => { const characters = Array.from(text); if (!characters.length) throw new Error("不能为文字为空的片段建立索引。"); for (let start = 0; start < characters.length; start += 400) { windows.push(characters.slice(start, start + 400).join("")); owners.push(owner); } });
  const sums: number[][] = texts.map(() => []);
  for (let start = 0; start < windows.length; start += 8) {
    const tensor = await pipe(windows.slice(start, start + 8), { pooling: "cls", normalize: true });
    const vectors = tensor.tolist() as number[][];
    vectors.forEach((vector, index) => { const owner = owners[start + index]; if (!sums[owner].length) sums[owner] = vector.map(() => 0); vector.forEach((value, dimension) => { sums[owner][dimension] += value; }); });
  }
  return sums.map(vector => { const length = Math.hypot(...vector); if (!length || vector.some(value => !Number.isFinite(value))) throw new Error("本机模型返回无效向量，原索引已保留。"); return vector.map(value => value / length); });
}
