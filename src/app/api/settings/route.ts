import { NextResponse } from "next/server";
import { prepareModelSettings, publicModelSettings, saveModelSettings } from "@/server/model-settings";
import { readSettingsRequest, settingsError } from "@/server/settings-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(publicModelSettings(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return settingsError(error); }
}
export async function PUT(request: Request) {
  try { const config = prepareModelSettings(await readSettingsRequest(request)); saveModelSettings(config); return NextResponse.json(publicModelSettings(config), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return settingsError(error); }
}
