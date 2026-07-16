import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace } from "@/lib/server/workspace";
import { listTemplates, deleteTemplate, getTemplateDraft } from "@/lib/suprsend-mgmt";

// GET — list the workspace's templates, or one template's draft (?slug=…) for the
// embedded editor. Reading only; templates are authored in the SuprSend editor.
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const slug = new URL(req.url).searchParams.get("slug");
    if (slug) {
      const template = await getTemplateDraft(ws.slug, slug);
      if (!template) return NextResponse.json({ ok: false, error: "Template not found." }, { status: 404 });
      return NextResponse.json({ ok: true, template });
    }
    const templates = await listTemplates(ws.slug);
    return NextResponse.json({ ok: true, templates });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const slug = new URL(req.url).searchParams.get("slug");
    if (!slug) return NextResponse.json({ ok: false, error: "slug required" }, { status: 400 });
    const result = await deleteTemplate(ws.slug, slug);
    return NextResponse.json({ ok: result.ok, status: result.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
