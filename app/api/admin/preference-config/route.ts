import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace } from "@/lib/server/workspace";
import { getPreferenceConfig, savePreferenceConfig, saveCategoryDigest, saveCategoryConditions, type PrefEdit } from "@/lib/server/preference-config";
import type { DigestOption } from "@/components/preferences/digest-frequency";
import type { Condition } from "@/components/admin/conditions-cell";

export async function GET() {
  try {
    const ws = await getActiveWorkspace();
    const categories = await getPreferenceConfig(ws.slug);
    return NextResponse.json({ ok: true, categories });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const body = (await req.json()) as {
      edits?: PrefEdit[];
      digest?: { category: string; options: DigestOption[]; enabled: boolean };
      conditions?: { category: string; conditions: Condition[] };
    };
    // Digest-schedule save (workspace default cadences for one category).
    if (body.digest) {
      const { category, options, enabled } = body.digest;
      if (!category || !Array.isArray(options)) {
        return NextResponse.json({ ok: false, error: "digest.category + digest.options[] required" }, { status: 400 });
      }
      const result = await saveCategoryDigest(ws.slug, category, options, enabled ?? false);
      return NextResponse.json({ ok: result.ok, status: result.status });
    }
    // Conditions save (managed integer metrics, e.g. cost) — preserves role.
    if (body.conditions) {
      const { category, conditions } = body.conditions;
      if (!category || !Array.isArray(conditions)) {
        return NextResponse.json({ ok: false, error: "conditions.category + conditions[] required" }, { status: 400 });
      }
      const result = await saveCategoryConditions(ws.slug, category, conditions);
      return NextResponse.json({ ok: result.ok, status: result.status });
    }
    // Preference/channel edits.
    if (!Array.isArray(body.edits)) return NextResponse.json({ ok: false, error: "edits[] required" }, { status: 400 });
    const result = await savePreferenceConfig(ws.slug, body.edits);
    return NextResponse.json({ ok: result.ok, status: result.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

