import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { checkRuleOrigin, competitionErrorResponse } from "@/server/competitions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    checkRuleOrigin(request);
    const { id } = await context.params;
    return NextResponse.json({ version: getStore().competitions.ensureDraft(id) });
  } catch (error) { return competitionErrorResponse(error); }
}
