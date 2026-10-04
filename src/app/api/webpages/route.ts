import { NextResponse } from "next/server";
import { checkOrigin, errorResponse, textField } from "@/server/http";
import { captureWebpage } from "@/server/webpages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (Number(request.headers.get("content-length")) > 5000) throw new Error("抓取请求过长。");
    const input = await request.json();
    if (input.dynamic !== undefined && typeof input.dynamic !== "boolean") throw new Error("动态网页选项格式不正确。");
    return NextResponse.json(await captureWebpage(textField(input.url, "网页网址", 2000, true), input.dynamic === true));
  } catch (error) { return errorResponse(error); }
}
