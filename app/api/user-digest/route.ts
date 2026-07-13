import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import {
  getTenantCategoryPrefs,
  getUserPrefExtras,
  saveUserDigest,
  saveUserConditions,
  type Pref,
} from "@/lib/server/tenant-prefs";
import type { DigestOption } from "@/components/preferences/digest-frequency";
import type { Condition } from "@/components/admin/conditions-cell";

// A subscriber's own digest pick + condition values for the active project. GET
// returns, per category, the allowed cadence set + the user's pick + condition
// values. POST overrides the user's digest or condition value (the preference must
// ride along — the user endpoint requires it on every PATCH).
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const url = new URL(req.url);
    const distinctId = url.searchParams.get("distinct_id");
    if (!distinctId) return NextResponse.json({ ok: false, error: "distinct_id required" }, { status: 400 });
    const tenant = url.searchParams.get("tenant") || (await getActiveTenant());
    const cats = await getTenantCategoryPrefs(ws.slug, tenant);
    const extras = await Promise.all(cats.map((c) => getUserPrefExtras(ws.slug, distinctId, c.category, tenant)));
    return NextResponse.json({ ok: true, extras });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const body = (await req.json()) as {
      distinct_id?: string;
      tenant?: string;
      digest?: { category: string; option: DigestOption | null; preference: Pref };
      conditions?: { category: string; conditions: Condition[]; preference: Pref };
    };
    const distinctId = body.distinct_id;
    if (!distinctId) return NextResponse.json({ ok: false, error: "distinct_id required" }, { status: 400 });
    const tenant = body.tenant || (await getActiveTenant());
    if (body.digest) {
      const { category, option, preference } = body.digest;
      if (!category || !preference) return NextResponse.json({ ok: false, error: "digest.category + preference required" }, { status: 400 });
      const r = await saveUserDigest(ws.slug, distinctId, category, option ?? null, preference, tenant);
      return NextResponse.json({ ok: r.ok, status: r.status });
    }
    if (body.conditions) {
      const { category, conditions, preference } = body.conditions;
      if (!category || !Array.isArray(conditions) || !preference) {
        return NextResponse.json({ ok: false, error: "conditions.category + conditions[] + preference required" }, { status: 400 });
      }
      const r = await saveUserConditions(ws.slug, distinctId, category, conditions, preference, tenant);
      return NextResponse.json({ ok: r.ok, status: r.status });
    }
    return NextResponse.json({ ok: false, error: "digest or conditions required" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
