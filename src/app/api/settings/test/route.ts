import { NextResponse } from "next/server";
import { ApiProvider, ModelHttpError } from "@/server/provider";
import { prepareModelSettings, SettingsError } from "@/server/model-settings";
import { readSettingsRequest, settingsError } from "@/server/settings-http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const data = await readSettingsRequest(request) as Record<string, unknown>;
    const config = prepareModelSettings(data);
    const provider = new ApiProvider({ ...config, embeddingBaseUrl: config.embeddingBaseUrl || config.baseUrl, embeddingApiKey: config.embeddingApiKey || config.apiKey });
    if (data.target === "chat") { await provider.generate("这是连接测试，请只回复OK。", "请回复OK。"); return NextResponse.json({ message: "聊天模型连接成功。" }); }
    if (data.target === "embedding") { if (!config.embeddingModel) throw new SettingsError("请先启用并填写嵌入模型。"); const vectors = await provider.embed(["连接测试"]); return NextResponse.json({ message: `嵌入模型连接成功，向量维度为 ${vectors[0].length}。` }); }
    throw new SettingsError("请选择要测试的模型。");
  } catch (error) {
    if (error instanceof ModelHttpError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SettingsError) return settingsError(error);
    return NextResponse.json({ error: "连接测试失败：请检查API地址、密钥、模型名称及网络。配置未保存。" }, { status: 400 });
  }
}
