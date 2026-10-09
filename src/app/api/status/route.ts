import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { ApiProvider, readProviderConfig } from "@/server/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const store = getStore();
  const provider = new ApiProvider();
  const config = readProviderConfig();
  return NextResponse.json({
    documents: store.listDocuments(), answers: store.listAnswers(), chats: store.listChats(),
    model: { chatReady: provider.chatReady, embeddingReady: provider.embeddingReady,
      chatModel: config.chatModel, embeddingModel: config.embeddingModel, embeddingKey: provider.embeddingKey },
  });
}
