import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace } from "@/lib/server/workspace";
import { listUsers, getProjectRoles, listProjects } from "@/lib/server/users";

// Projects + people for the "Viewing as" switcher and the Projects list — ALL sourced
// from SuprSend: the project objects that EXIST in this workspace, and each object's
// subscriptions. Scoped to the active customer. Nothing read from a hardcoded list.
export async function GET() {
  try {
    const ws = await getActiveWorkspace();
    const [tenants, users] = await Promise.all([listProjects(ws), listUsers(ws)]);
    const nameOf = (id: string) => users.find((u) => u.distinctId === id)?.name ?? id;

    const projects = await Promise.all(
      tenants.map(async (t) => {
        const roles = await getProjectRoles(ws, t.id);
        const members = Object.keys(roles).map((id) => ({ id, name: nameOf(id), role: roles[id] }));
        // Stable order: PM, Process Owner, Sponsor, then Team Members by name.
        const rank = (r: string) =>
          r === "Project Manager" ? 0 : r === "Process Owner" ? 1 : r === "Project Sponsor" ? 2 : 3;
        members.sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));
        return { tenantId: t.id, label: t.name, members };
      }),
    );

    // The workspace Admin overseer (sentinel distinct_id "admin"). Surfaced on its own
    // so the UI can pin it (Resource Pool) and so it's NEVER treated as a poolable
    // person — it's already the "Admin" entry at the top of the Viewing-as picker.
    const adminUser = users.find((u) => u.distinctId === "admin");
    const admin = adminUser
      ? { id: adminUser.distinctId, name: adminUser.name, email: adminUser.email, role: adminUser.role ?? "Admin" }
      : null;

    // People in the customer pool who aren't a member of ANY project — surfaced as a
    // separate "Other users" group in the Viewing-as picker. Viewing as one of these
    // shows an empty Projects list (they belong to no project). The Admin overseer is
    // excluded: it's already pinned at the top of the picker (the sentinel), so listing
    // it here would duplicate it.
    const memberIds = new Set(projects.flatMap((p) => p.members.map((m) => m.id)));
    const otherUsers = users
      .filter((u) => u.distinctId !== "admin" && !memberIds.has(u.distinctId))
      .map((u) => ({ id: u.distinctId, name: u.name, role: u.role ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ ok: true, workspace: ws.slug, projects, otherUsers, admin });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
