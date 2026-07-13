import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import {
  getTenantCategoryPrefs,
  getTenantPrefExtras,
  saveTenantDigest,
  saveTenantConditions,
  saveTenantExcept,
  saveTenantInclude,
  saveTenantRoles,
} from "@/lib/server/tenant-prefs";
import type { DigestOption } from "@/components/preferences/digest-frequency";
import type { Condition } from "@/components/admin/conditions-cell";

// Per-project digest schedule + conditions (the override layer). GET returns, per
// category, the allowed cadence set + this project's override + its condition
// values. POST overrides the project's digest default or a condition value.
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tParam = new URL(req.url).searchParams.get("tenant");
    const tenant = tParam || (await getActiveTenant());
    const cats = await getTenantCategoryPrefs(ws.slug, tenant);
    const extras = await Promise.all(cats.map((c) => getTenantPrefExtras(ws.slug, tenant, c.category)));
    return NextResponse.json({ ok: true, extras });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    const body = (await req.json()) as {
      digest?: { category: string; option: DigestOption | null };
      conditions?: { category: string; conditions: Condition[] };
      except?: { category: string; distinctIds: string[] };
      include?: { category: string; distinctIds: string[] };
      roles?: { category: string; roles: string[] };
    };
    if (body.roles) {
      const { category, roles } = body.roles;
      if (!category || !Array.isArray(roles)) {
        return NextResponse.json({ ok: false, error: "roles.category + roles[] required" }, { status: 400 });
      }
      const r = await saveTenantRoles(ws.slug, tenant, category, roles);
      return NextResponse.json({ ok: r.ok, status: r.status });
    }
    if (body.except) {
      const { category, distinctIds } = body.except;
      if (!category || !Array.isArray(distinctIds)) {
        return NextResponse.json({ ok: false, error: "except.category + distinctIds[] required" }, { status: 400 });
      }
      const r = await saveTenantExcept(ws.slug, tenant, category, distinctIds);
      return NextResponse.json({ ok: r.ok, status: r.status });
    }
    if (body.include) {
      const { category, distinctIds } = body.include;
      if (!category || !Array.isArray(distinctIds)) {
        return NextResponse.json({ ok: false, error: "include.category + distinctIds[] required" }, { status: 400 });
      }
      const r = await saveTenantInclude(ws.slug, tenant, category, distinctIds);
      return NextResponse.json({ ok: r.ok, status: r.status });
    }
    if (body.digest) {
      const { category, option } = body.digest;
      if (!category) return NextResponse.json({ ok: false, error: "digest.category required" }, { status: 400 });
      const r = await saveTenantDigest(ws.slug, tenant, category, option ?? null);
      return NextResponse.json({ ok: r.ok, status: r.status });
    }
    if (body.conditions) {
      const { category, conditions } = body.conditions;
      if (!category || !Array.isArray(conditions)) {
        return NextResponse.json({ ok: false, error: "conditions.category + conditions[] required" }, { status: 400 });
      }
      const r = await saveTenantConditions(ws.slug, tenant, category, conditions);
      return NextResponse.json({ ok: r.ok, status: r.status });
    }
    return NextResponse.json({ ok: false, error: "digest or conditions required" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
