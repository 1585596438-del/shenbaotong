import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { ApiProvider, readProviderConfig } from "@/server/provider";
import { embeddingIssue } from "@/server/embedding-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const store = getStore();
  const provider = new ApiProvider();
  const config = readProviderConfig();
  const documents = store.listDocuments();
  return NextResponse.json({
    documents, answers: store.listAnswers(), chats: store.listChats(),
    model: { chatReady: provider.chatReady, embeddingReady: provider.embeddingReady,
      chatModel: config.chatModel, embeddingModel: config.embeddingModel, embeddingKey: provider.embeddingKey,
      embeddingIssue: embeddingIssue(config.embeddingBaseUrl, config.embeddingModel),
      indexedDocuments: documents.filter(d => d.chunkCount > 0 && d.indexedCount === d.chunkCount && d.embeddingKey === provider.embeddingKey).length },
  });
}
