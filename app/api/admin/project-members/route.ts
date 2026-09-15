import { NextResponse } from "next/server";
import type { Workspace } from "@/lib/workspaces";
import { errMsg, projectLink } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import { triggerObjectWorkflow } from "@/lib/server/hub";
import {
  listUsers,
  getProjectSubscribers,
  unsubscribeUserFromProject,
  assignProjectRole,
} from "@/lib/server/users";
import { getTenantPrefExtras } from "@/lib/server/tenant-prefs";
import { PROJECT_MANAGER } from "@/lib/roles";

// Fire Project Assigned when a project's PM changes — as an OBJECT trigger. SuprSend
// fans out to the project's subscribers from the object's CURRENT state, so there's no
// recipient resolution in the app: we assign the new PM on the object and pass the new
// PM's name as one delta. The template branches on the recipient's role; narrowing to
// PM + Process Owner is the preference-conditions layer.
async function fireProjectAssigned(ws: Workspace, tenant: string, newPmId: string, link: string) {
  const users = await listUsers(ws);
  const newPmName = users.find((u) => u.distinctId === newPmId)?.name ?? newPmId;
  await triggerObjectWorkflow(
    ws,
    {
      workflow: "project-assigned",
      objectType: "project",
      objectId: tenant,
      data: {
        project_id: tenant,
        project_link: link,
        new_pm_name: newPmName,
        except: (await getTenantPrefExtras(ws.slug, tenant, "project-assigned").catch(() => ({ except: [] as string[] }))).except ?? [],
      },
    },
    tenant,
  ).catch(() => {});
}

// Project membership = subscriptions on the project OBJECT (the SuprSend source of
// truth). Admin/PM add / remove / change-role here, and it writes straight to the
// object — so Resources, role-gating and recipient resolution all follow. People are
// existing SuprSend users; this route never creates one.
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    // `?tenant=` lets the Projects listing read roles for a row that isn't the active
    // project; defaults to the active project (the in-project Resources tab).
    const tParam = new URL(req.url).searchParams.get("tenant");
    const tenant = tParam || (await getActiveTenant());
    // ALL object subscribers (incl. role-less "Others"/watchers), so they show as
    // members here rather than leaking into the add-candidates list. No project yet →
    // everyone in the workspace is a candidate.
    const [allRaw, roles] = await Promise.all([
      listUsers(ws),
      tenant ? getProjectSubscribers(ws, tenant) : Promise.resolve({} as Record<string, string>),
    ]);
    // Exclude the Admin overseer sentinel — it's not a real project person.
    const all = allRaw.filter((u) => u.distinctId !== "admin");
    const memberIds = new Set(Object.keys(roles));
    const members = all
      .filter((u) => memberIds.has(u.distinctId))
      .map((u) => ({ distinctId: u.distinctId, name: u.name, email: u.email, role: roles[u.distinctId] || null }));
    // Candidates = workspace users not already on this project.
    const candidates = all
      .filter((u) => !memberIds.has(u.distinctId))
      .map((u) => ({ distinctId: u.distinctId, name: u.name, email: u.email }));
    return NextResponse.json({ ok: true, members, candidates });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

// POST adds an existing workspace user to the project object with a role. Assigning a
// single-occupancy role removes the previous holder from the project; a PM change
// fires Project Assigned.
export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    const body = (await req.json()) as { distinctId?: string; role?: string; tenant?: string };
    if (!body.distinctId || !body.role) {
      return NextResponse.json({ ok: false, error: "distinctId and role required" }, { status: 400 });
    }
    const projectId = typeof body.tenant === "string" && body.tenant ? body.tenant : tenant;
    await assignProjectRole(ws, projectId, body.distinctId, body.role);
    if (body.role === PROJECT_MANAGER) await fireProjectAssigned(ws, projectId, body.distinctId, projectLink(req, projectId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

// Change a member's role. Assigning a single-occupancy role removes the previous
// holder from the project; a PM change fires Project Assigned. `tenant` in the body
// lets the Projects listing reassign a PM for a row that isn't the active project.
export async function PATCH(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const active = await getActiveTenant();
    const { distinctId, role, tenant } = (await req.json()) as { distinctId?: string; role?: string; tenant?: string };
    if (!distinctId || !role) {
      return NextResponse.json({ ok: false, error: "distinctId and role required" }, { status: 400 });
    }
    const projectId = typeof tenant === "string" && tenant ? tenant : active;
    await assignProjectRole(ws, projectId, distinctId, role);
    if (role === PROJECT_MANAGER) await fireProjectAssigned(ws, projectId, distinctId, projectLink(req, projectId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

// Remove a member (delete their object subscription).
export async function DELETE(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    const distinctId = new URL(req.url).searchParams.get("distinct_id");
    if (!distinctId) return NextResponse.json({ ok: false, error: "distinct_id required" }, { status: 400 });
    await unsubscribeUserFromProject(ws, tenant, distinctId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
