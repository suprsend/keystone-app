import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace } from "@/lib/server/workspace";
import { getUserSubscriptions } from "@/lib/server/users";

// An employee's subscriptions — team objects + subscriber lists they belong to.
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const id = new URL(req.url).searchParams.get("distinct_id");
    if (!id) return NextResponse.json({ ok: false, error: "distinct_id required" }, { status: 400 });
    const subscriptions = await getUserSubscriptions(ws, id);
    return NextResponse.json({ ok: true, subscriptions });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
