import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace } from "@/lib/server/workspace";
import { getNotifConfig, setWorkflowRecipients } from "@/lib/server/notif-recipients";
import { getRoleOptions, saveCategoryRoles } from "@/lib/server/preference-config";

// Read/update a notification's recipient roles (recipient TYPES). Stored as
// `recip:<role>` tags on the live SuprSend workflow, so edits persist and drive
// both role-filtered fan-out and role-based category visibility.
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const slug = new URL(req.url).searchParams.get("slug");
    const roleOptions = await getRoleOptions(ws.slug);
    const cfg = await getNotifConfig(ws.slug, roleOptions);
    // No slug → return every notification's config (slug + category + roles) and the
    // roles a notification can target, so the settings tables can show/edit recipients.
    if (!slug) return NextResponse.json({ ok: true, configs: cfg, roleOptions });
    const found = cfg.find((c) => c.slug === slug);
    return NextResponse.json({ ok: true, roles: found?.roles ?? [], emails: found?.emails ?? [], live: Boolean(found) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const { slug, roles, emails, category } = (await req.json()) as {
      slug: string;
      roles: string[];
      emails?: string[];
      category?: string;
    };
    if (!slug || !Array.isArray(roles)) {
      return NextResponse.json({ ok: false, error: "slug and roles[] required" }, { status: 400 });
    }
    const result = await setWorkflowRecipients(ws.slug, slug, roles, Array.isArray(emails) ? emails : []);
    // Recipients must also drive DELIVERY, not just display: write the category's
    // `role` condition attribute (the workspace default the workflow condition falls
    // back to). The `recip:` tags above stay an app-convention label. `category` is
    // the preference-category slug (≠ workflow slug for a few), passed by the client.
    let roleSync = { ok: true, status: 200 };
    if (category) roleSync = await saveCategoryRoles(ws.slug, category, roles);
    return NextResponse.json({ ok: result.ok && roleSync.ok, status: roleSync.ok ? result.status : roleSync.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
