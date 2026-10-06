import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { checkRuleOrigin, competitionErrorResponse, readRuleJson } from "@/server/competitions/http";
import { validatePublishRequest } from "@/server/competitions/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    checkRuleOrigin(request);
    const { id } = await context.params;
    const { expectedRevision } = validatePublishRequest(await readRuleJson(request));
    return NextResponse.json({ version: getStore().competitions.publish(id, expectedRevision) });
  } catch (error) { return competitionErrorResponse(error); }
}
