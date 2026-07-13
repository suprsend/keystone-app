import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveTenant, getActiveWorkspace } from "@/lib/server/workspace";
import { getOptOutSummary } from "@/lib/server/opt-outs";

export async function GET() {
  try {
    const ws = await getActiveWorkspace();
    const summary = await getOptOutSummary(ws, await getActiveTenant());
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
