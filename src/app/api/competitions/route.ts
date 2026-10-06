import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { checkRuleOrigin, competitionErrorResponse, readRuleJson } from "@/server/competitions/http";
import { validateCreateRequest } from "@/server/competitions/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = getStore().competitions;
    return NextResponse.json({ competitions: store.listCompetitions(), items: store.list() });
  } catch (error) { return competitionErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    checkRuleOrigin(request);
    const input = validateCreateRequest(await readRuleJson(request));
    const store = getStore().competitions;
    return NextResponse.json(input.action === "competition"
      ? { competition: store.createCompetition(input.input) }
      : { event: store.createEvent(input.input) }, { status: 201 });
  } catch (error) { return competitionErrorResponse(error); }
}
