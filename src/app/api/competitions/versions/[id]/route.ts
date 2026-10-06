import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { checkRuleOrigin, competitionErrorResponse, readRuleJson } from "@/server/competitions/http";
import { validateSaveDraft } from "@/server/competitions/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    checkRuleOrigin(request);
    const { id } = await context.params;
    const input = validateSaveDraft(await readRuleJson(request));
    return NextResponse.json({ version: getStore().competitions.saveDraft(id, input) });
  } catch (error) { return competitionErrorResponse(error); }
}
