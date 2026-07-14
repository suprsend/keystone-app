import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import {
  listUsers, upsertUser, removeUser, getUser,
  addToAllEmployeesList, ONBOARDING_EVENT, getProjectRoles,
} from "@/lib/server/users";
import { getProjectPeople } from "@/lib/server/workspace-data";
import { trackEvent } from "@/lib/server/hub";
import { getWorkflowTriggerData } from "@/lib/suprsend-mgmt";

const ONBOARDING_WORKFLOW = "employee-onboarding";

// SuprSend users belong to the WORKSPACE (customer), but the app is project-scoped:
// each project shows only ITS members. Membership = the Workspace Data store (the
// per-project roster, incl. people added/removed in the grid). ROLE is per-project
// and lives on the PROJECT OBJECT's subscription (a user can be on >1 project with
// different roles), so we overlay it from the object — not the (global, unset) user prop.
export async function GET() {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    const [all, roles] = await Promise.all([listUsers(ws), getProjectRoles(ws, tenant)]);
    // Membership + role both come from the PROJECT OBJECT's subscriptions (the
    // SuprSend source of truth). Fall back to the store only if the object returns
    // nothing (e.g. a workspace without keys).
    const objIds = Object.keys(roles);
    const memberIds = new Set(objIds.length ? objIds : getProjectPeople(tenant).map((p) => p.id));
    const users = all
      .filter((u) => memberIds.has(u.distinctId))
      .map((u) => ({ ...u, role: roles[u.distinctId] ?? u.role }));
    return NextResponse.json({ ok: true, users });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

// Add or update an employee. New employees get a distinct_id slugged from the name.
export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const { distinct_id, name, email, role } = await req.json();
    const id = distinct_id || slug(name);
    if (!id) return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    const isCreate = !distinct_id;
    if (isCreate) {
      // creating new — require an email so they can actually receive
      if (!email || !/.+@.+\..+/.test(email)) {
        return NextResponse.json({ ok: false, error: "A valid email is required for a new employee." }, { status: 400 });
      }
      if (await getUser(ws, id)) {
        return NextResponse.json({ ok: false, error: `An employee “${id}” already exists.` }, { status: 409 });
      }
    }
    // Teams (the third channel) is display-only — no real webhook delivery wired
    // (Keystone uses Teams, not Slack), so nothing channel-specific to attach here.
    await upsertUser(ws, id, { name, email, role });

    // New hire → add to the company list and emit the onboarding event. The
    // event-triggered onboarding workflow fires automatically (showcases an
    // event trigger end-to-end — no manual Send test). Best-effort: a failure
    // here must not fail the user create, so we don't await-throw it.
    let onboardingFired = false;
    if (isCreate) {
      // Carry the FULL onboarding payload on the event — every variable the
      // onboarding templates use (link, manager_name, manager_contact, …) pulled
      // from their sample data, with this hire's real name layered on top. Without
      // this the welcome email renders with blank merge fields on a live add.
      const base = await getWorkflowTriggerData(ws.slug, ONBOARDING_WORKFLOW).catch(() => ({}));
      const payload = { ...base, employee_name: name ?? id, name: name ?? id, role: role ?? "" };
      await Promise.allSettled([
        addToAllEmployeesList(ws, id),
        trackEvent(ws, id, ONBOARDING_EVENT, payload).then(() => { onboardingFired = true; }),
      ]);
    }
    return NextResponse.json({ ok: true, distinctId: id, onboardingFired });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const id = new URL(req.url).searchParams.get("distinct_id");
    if (!id) return NextResponse.json({ ok: false, error: "distinct_id required" }, { status: 400 });
    await removeUser(ws, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

function slug(name?: string): string {
  return (name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
