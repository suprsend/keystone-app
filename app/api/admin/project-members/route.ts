import { NextResponse } from "next/server";
import type { Workspace } from "@/lib/workspaces";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import { triggerObjectWorkflow } from "@/lib/server/hub";
import {
  listUsers,
  getProjectSubscribers,
  unsubscribeUserFromProject,
  assignProjectRole,
  upsertUser,
  addToAllEmployeesList,
} from "@/lib/server/users";
import { getTenantPrefExtras } from "@/lib/server/tenant-prefs";
import { safeEmail } from "@/lib/safe-email";

const PM_ROLE = "Project Manager";

// Fire Project Assigned (PHX-18688) when a project's PM changes — as an OBJECT trigger.
// SuprSend fans out to the project's subscribers from the object's CURRENT state, so
// there's no recipient resolution or previous-PM handling in the app: we only assign
// the new PM on the object and pass the new PM's name as one delta. The template's
// generic branch renders "A new project manager, <name>, was assigned." (Role
// narrowing to PM + Process Owner is the preference-conditions layer.)
async function fireProjectAssigned(ws: Workspace, tenant: string, newPmId: string) {
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
        project_link: `https://app.keystone.com/projects/${tenant}`,
        new_pm_name: newPmName,
        except: (await getTenantPrefExtras(ws.slug, tenant, "project-assigned").catch(() => ({ except: [] as string[] }))).except ?? [],
      },
    },
    tenant,
  ).catch(() => {});
}

// EMAIL SAFETY (an incident happened — never repeat): a demo user's email is plus-
// addressed to the one safe inbox so it can't reach real people. Policy lives in
// lib/safe-email.ts (configurable via SAFE_TEST_EMAIL_USER / _DOMAIN).

// Project membership = subscriptions on the project OBJECT (the SuprSend source of
// truth). Admin/PM add / remove / change-role here, and it writes straight to the
// object — so Resources, role-gating and recipient resolution all follow.
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    // `?tenant=` lets the Projects listing read roles for a row that isn't the active
    // project; defaults to the active project (the in-project Resources tab).
    const tParam = new URL(req.url).searchParams.get("tenant");
    const tenant = tParam || (await getActiveTenant());
    // ALL object subscribers (incl. role-less "Others"/watchers), so they show as
    // members here rather than leaking into the add-candidates list.
    const [allRaw, roles] = await Promise.all([listUsers(ws), getProjectSubscribers(ws, tenant)]);
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

// POST adds someone to the project object. Two shapes:
//  • { distinctId, role }   → subscribe an EXISTING workspace user (also upserts role).
//  • { name, email?, role } → PROVISION a brand-new SuprSend user (email-safe), add to
//    the all-employees list, then subscribe to this project with the role.
export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    const body = (await req.json()) as { distinctId?: string; name?: string; email?: string; role?: string; tenant?: string };
    const role = body.role;
    if (!role) return NextResponse.json({ ok: false, error: "role required" }, { status: 400 });
    const projectId = typeof body.tenant === "string" && body.tenant ? body.tenant : tenant;

    // Existing user (from the pool) — assigning a single-occupancy role removes the
    // previous holder from the project; a PM change fires Project Assigned.
    if (body.distinctId) {
      await assignProjectRole(ws, projectId, body.distinctId, role);
      if (role === PM_ROLE) await fireProjectAssigned(ws, projectId, body.distinctId);
      return NextResponse.json({ ok: true });
    }

    // Create a brand-new member.
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "Name required" }, { status: 400 });
    const em = safeEmail(body.email, name);
    if (!em.ok) return NextResponse.json({ ok: false, error: em.error }, { status: 400 });

    const distinctId = `u_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "")}`;
    if (!distinctId || distinctId === "u_") {
      return NextResponse.json({ ok: false, error: "Name must contain letters or numbers" }, { status: 400 });
    }

    // Provision the SuprSend user (email-safe + Slack), join the all-employees list,
    // then assign the role on the project object (removing any current holder of a
    // single-occupancy role); a new PM fires Project Assigned.
    await upsertUser(ws, distinctId, {
      name,
      email: em.email,
      role,
    });
    await addToAllEmployeesList(ws, distinctId).catch(() => {});
    await assignProjectRole(ws, projectId, distinctId, role);
    if (role === PM_ROLE) await fireProjectAssigned(ws, projectId, distinctId);
    return NextResponse.json({ ok: true, distinctId, email: em.email });
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
    if (role === PM_ROLE) await fireProjectAssigned(ws, projectId, distinctId);
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
