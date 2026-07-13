import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveTenant, getActiveWorkspace } from "@/lib/server/workspace";
import { getPreferenceConfig } from "@/lib/server/preference-config";
import { getTenantCategoryPrefs, updateTenantCategoryPref, type TenantPrefEdit } from "@/lib/server/tenant-prefs";

// Per-PROJECT (tenant) category defaults. Merges the workspace category metadata
// (names, sections, descriptions, the org default preference) with this tenant's
// overrides so the admin sees what each category falls back to and what they've
// changed for this project.
export async function GET() {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    const [config, tenantPrefs] = await Promise.all([
      getPreferenceConfig(ws.slug),
      getTenantCategoryPrefs(ws.slug, tenant),
    ]);
    const byCat = new Map(tenantPrefs.map((p) => [p.category, p]));
    const rows = config.map((c) => {
      const t = byCat.get(c.category);
      return {
        category: c.category,
        name: c.name,
        section: c.section,
        description: c.description,
        categoryDefault: c.preference, // org/category fallback when no tenant override
        preference: t?.preference ?? null, // tenant override (null = inherit)
        visibleToSubscriber: t?.visibleToSubscriber ?? true,
        // The channels this category can deliver on, and the ones this tenant
        // has opted OUT of (blocked) for it.
        channels: c.optInChannels ?? [],
        blockedChannels: t?.blockedChannels ?? [],
      };
    });
    return NextResponse.json({ ok: true, tenant, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    const { edits } = (await req.json()) as { edits: TenantPrefEdit[] };
    if (!Array.isArray(edits)) return NextResponse.json({ ok: false, error: "edits[] required" }, { status: 400 });
    const results = await Promise.all(edits.map((e) => updateTenantCategoryPref(ws.slug, tenant, e)));
    const failed = results.find((r) => !r.ok);
    return NextResponse.json({ ok: !failed, status: failed?.status ?? 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
