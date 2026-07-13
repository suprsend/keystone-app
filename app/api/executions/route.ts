import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveTenant, getActiveWorkspace } from "@/lib/server/workspace";
import { listMessageRecords } from "@/lib/server/messages";

export async function GET() {
  try {
    const ws = await getActiveWorkspace();
    const messages = await listMessageRecords(ws, await getActiveTenant());
    return NextResponse.json({ ok: true, messages });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
