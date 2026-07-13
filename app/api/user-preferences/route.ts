import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveTenant, getActiveWorkspace } from "@/lib/server/workspace";
import { getUser } from "@/lib/server/users";
import { getUserCategories, updateUserCategory } from "@/lib/server/subscriber-prefs";

// The "viewing as" employee's OWN preferences. Synchronous hub PATCH (no client
// debounce) so a toggle persists even on immediate navigation. The actor is a
// LIVE SuprSend subscriber (the "viewing as" roster) — validate against the hub.
async function valid(ws: Parameters<typeof getUser>[0], distinctId: string | null) {
  if (!distinctId) return null;
  return getUser(ws, distinctId);
}

// Preference scope: "global" = the user's profile-wide baseline (default tenant);
// otherwise the active project (tenant). The Profile tab passes scope=global; the
// Project tab passes its tenant explicitly (from the URL) — we trust that over the
// ambient cookie so a save can't land on the wrong (or default) tenant. Falls back
// to the cookie only when no explicit tenant is given.
async function scopeTenant(scope: string | null | undefined, tenant?: string | null): Promise<string> {
  if (scope === "global") return "default";
  return await getActiveTenant(tenant);
}

export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const url = new URL(req.url);
    const distinctId = url.searchParams.get("distinct_id");
    if (!(await valid(ws, distinctId))) {
      return NextResponse.json({ ok: false, error: "Unknown employee for this tenant." }, { status: 400 });
    }
    const categories = await getUserCategories(
      ws,
      distinctId!,
      await scopeTenant(url.searchParams.get("scope"), url.searchParams.get("tenant")),
    );
    return NextResponse.json({ ok: true, categories });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const { distinct_id, category, preference, opt_out_channels, scope, tenant } = await req.json();
    if (!(await valid(ws, distinct_id))) {
      return NextResponse.json({ ok: false, error: "Unknown employee for this tenant." }, { status: 400 });
    }
    if (!category || (preference !== "opt_in" && preference !== "opt_out")) {
      return NextResponse.json({ ok: false, error: "category + valid preference required" }, { status: 400 });
    }
    const result = await updateUserCategory(ws, distinct_id, category, preference, Array.isArray(opt_out_channels) ? opt_out_channels : [], await scopeTenant(scope, tenant));
    return NextResponse.json({ ok: result.ok, status: result.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

