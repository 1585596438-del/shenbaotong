import { NextResponse } from "next/server";
import { checkOrigin, errorResponse } from "@/server/http";
import { indexDocument } from "@/server/rag";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const { id } = await context.params;
    const document = await indexDocument(id);
    return NextResponse.json({ document });
  } catch (error) { return errorResponse(error); }
}
