import { NextResponse } from "next/server";
import { getStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: {params:Promise<{id:string}>}) {
  const {id} = await context.params;
  const detail = getStore().getChat(id);
  return detail ? NextResponse.json(detail) : NextResponse.json({error:"聊天不存在，请重新选择。"},{status:404});
}
