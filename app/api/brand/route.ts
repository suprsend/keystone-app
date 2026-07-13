import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace } from "@/lib/server/workspace";
import { getBrand, updateBrand, type Brand } from "@/lib/server/brand";

// Admin Branding edits the WORKSPACE default brand — SuprSend's `default` tenant,
// the account-wide fallback for {{$brand.*}}. Per-project brand variants are
// adjusted in the Project view, not here.
const WORKSPACE_DEFAULT_TENANT = "default";

export async function GET() {
  try {
    const ws = await getActiveWorkspace();
    return NextResponse.json({ ok: true, brand: await getBrand(ws, WORKSPACE_DEFAULT_TENANT) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const b = (await req.json()) as Brand;
    if (!b || typeof b.tenantName !== "string") {
      return NextResponse.json({ ok: false, error: "Brand name is required." }, { status: 400 });
    }
    await updateBrand(ws, WORKSPACE_DEFAULT_TENANT, b);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

