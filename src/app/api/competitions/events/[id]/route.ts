import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { competitionErrorResponse } from "@/server/competitions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ detail: getStore().competitions.getDetail(id) });
  } catch (error) { return competitionErrorResponse(error); }
}
