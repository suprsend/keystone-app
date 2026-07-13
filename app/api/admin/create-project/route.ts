import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace } from "@/lib/server/workspace";
import { createProject, listProjects } from "@/lib/server/users";

// Create a project = a SuprSend object (membership) + tenant (brand) + role
// subscriptions, all in the active customer. Returns the new id so the UI can route
// to it. Users are NOT created here — only existing customer people are mapped.
export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const { name, members } = (await req.json()) as {
      name?: string;
      members?: { distinctId: string; role: string }[];
    };
    const trimmed = (name ?? "").trim();
    if (!trimmed) return NextResponse.json({ ok: false, error: "Project name is required." }, { status: 400 });
    const mem = Array.isArray(members) ? members.filter((m) => m?.distinctId && m?.role) : [];
    if (!mem.some((m) => m.role === "Project Manager")) {
      return NextResponse.json({ ok: false, error: "A Project Manager is required." }, { status: 400 });
    }

    // Derive a unique object/tenant id from the name (scoped to this customer).
    const base = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";
    const existing = new Set((await listProjects(ws)).map((p) => p.id));
    let id = base;
    for (let i = 2; existing.has(id); i++) id = `${base}-${i}`;

    await createProject(ws, { id, name: trimmed, members: mem });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
