import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import { listUsers, getProjectRoles } from "@/lib/server/users";

// SuprSend users belong to the WORKSPACE (customer), but the app is project-scoped:
// each project shows only ITS members. Membership and ROLE both come from the PROJECT
// OBJECT's subscriptions (a user can be on >1 project with different roles), not the
// user's own properties. No active project → no members.
export async function GET() {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    if (!tenant) return NextResponse.json({ ok: true, users: [] });
    const [all, roles] = await Promise.all([listUsers(ws), getProjectRoles(ws, tenant)]);
    const users = all
      .filter((u) => u.distinctId in roles)
      .map((u) => ({ ...u, role: roles[u.distinctId] }));
    return NextResponse.json({ ok: true, users });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
