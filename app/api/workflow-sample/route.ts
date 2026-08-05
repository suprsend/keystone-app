import { NextResponse } from "next/server";
import { errMsg, isSlug, INVALID_SLUG } from "@/lib/server/http";
import { getActiveWorkspace } from "@/lib/server/workspace";
import { getWorkflow, getWorkflowTriggerData } from "@/lib/suprsend-mgmt";

// Everything the Test form needs for one workflow: prefilled event properties
// (union of its templates' sample data) + whether it's event-triggered + the event name.
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const slug = new URL(req.url).searchParams.get("slug");
    if (!slug) return NextResponse.json({ ok: false, error: "slug required" }, { status: 400 });
    if (!isSlug(slug)) return NextResponse.json({ ok: false, error: INVALID_SLUG }, { status: 400 });

    const [detail, sample] = await Promise.all([
      getWorkflow(ws.slug, slug),
      getWorkflowTriggerData(ws.slug, slug).catch(() => ({}) as Record<string, string>),
    ]);
    const body = (detail.ok ? detail.body : {}) as { trigger_type?: string; trigger_events?: string[] };
    return NextResponse.json({
      ok: true,
      sample,
      isEvent: body.trigger_type === "event",
      eventName: body.trigger_events?.[0] ?? "",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
