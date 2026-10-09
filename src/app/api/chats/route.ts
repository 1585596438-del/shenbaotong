import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { checkOrigin, errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ chats: getStore().listChats() }); }
export async function POST(request: Request) {
  try { checkOrigin(request); return NextResponse.json(getStore().createChat(),{status:201}); }
  catch (error) { return errorResponse(error); }
}
