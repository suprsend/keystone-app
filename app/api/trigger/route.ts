import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveTenant, getActiveWorkspace } from "@/lib/server/workspace";
import { triggerWorkflow, trackEvent, triggerUsers } from "@/lib/server/hub";
import { getWorkflowTriggerData, getWorkflow } from "@/lib/suprsend-mgmt";
import { getUser } from "@/lib/server/users";
import { getTenant } from "@/lib/tenants";
import { type PersonRole } from "@/lib/people";
import { getNotifConfig } from "@/lib/server/notif-recipients";
import { getProjectPeople, getProjectPmName } from "@/lib/server/workspace-data";

// Sentinel recipient for "send to the whole project" → role-filtered fan-out.
const WHOLE_PROJECT = "__project__";

// Per-recipient relationship type — drives the {{recipient_type}} conditional copy
// (e.g. Project Assigned). A role-based tester can't know "previous PM", so the PM
// maps to new_pm; the rest map by role. Templates ignore it where not used.
const ROLE_TO_TYPE: Record<string, string> = {
  "Project Manager": "new_pm",
  "Process Owner": "process_owner",
  "Project Sponsor": "project_sponsor",
  "Team Member": "team_member",
};
const typeForRole = (role?: string | null) => ROLE_TO_TYPE[(role ?? "") as PersonRole] ?? "";

// Send a test: resolve the recipient from the LIVE SuprSend roster (the Users tab),
// then trigger the workflow. Or send to the whole project (object fan-out).
export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const { workflow_slug, employee_id, data, tenant: tenantOverride } = await req.json();
    // The Test panel can target a specific tenant; otherwise use the active one.
    const tenant = await getActiveTenant(tenantOverride);
    if (!workflow_slug || !employee_id) {
      return NextResponse.json({ ok: false, error: "workflow_slug and employee_id are required." }, { status: 400 });
    }

    // How this workflow runs: event-type workflows only execute via track_event
    // (per user) — NOT via the workflow-trigger API with user recipients.
    const wf = await getWorkflow(ws.slug, workflow_slug);
    const wfBody = (wf?.body ?? {}) as { trigger_type?: string; trigger_events?: string[] };
    const isEvent = wfBody.trigger_type === "event";
    const eventName = wfBody.trigger_events?.[0];
    const base = await getWorkflowTriggerData(ws.slug, workflow_slug);

    // Whole-project mode: ROLE-FILTERED fan-out. The notification declares which
    // roles it targets (PRD recipients); we resolve the project members with those
    // roles (the project object's subscribers) and notify only them. Per-recipient
    // preferences still gate each send.
    if (employee_id === WHOLE_PROJECT) {
      // Recipient roles come from the LIVE workflow config (recip: tags), keyed by
      // workflow slug — so admin recipient-type edits take effect immediately.
      const cfg = await getNotifConfig(ws.slug);
      const roles = cfg.find((c) => c.slug === workflow_slug)?.roles ?? [];
      const targets = getProjectPeople(tenant).filter((p) => roles.includes(p.role));
      if (targets.length === 0) {
        return NextResponse.json({ ok: false, error: "No project members match this notification's recipient roles." }, { status: 400 });
      }
      // new_pm_name (for Project Assigned conditional copy) = the project's current PM (store).
      const pmName = getProjectPmName(tenant);
      const payload = { ...base, new_pm_name: pmName, ...(data ?? {}) };
      if (isEvent && eventName) {
        // Event workflow → track the event for each target so SuprSend runs it.
        // Personalize per recipient: name/role AND recipient_type (so per-recipient
        // conditional copy renders, not the sample's). Greeting uses $recipient.name.
        await Promise.all(targets.map((t) => trackEvent(ws, t.id, eventName, { ...payload, employee_name: t.name, role: t.role, recipient_type: typeForRole(t.role) }, tenant)));
      } else {
        await triggerUsers(ws, workflow_slug, targets.map((t) => t.id), payload, tenant);
      }
      const proj = getTenant(tenant);
      const roleList = [...new Set(targets.map((t) => t.role))].join(", ");
      return NextResponse.json({ ok: true, recipient: `${targets.length} on ${proj.label} (${roleList})`, fanout: true });
    }
    const emp = await getUser(ws, employee_id);
    if (!emp) {
      return NextResponse.json({ ok: false, error: "Unknown employee for this tenant." }, { status: 400 });
    }
    if (!emp.email) {
      return NextResponse.json({ ok: false, error: `${emp.name} has no email — add one in the Users tab.` }, { status: 400 });
    }

    // Single recipient. Build a complete payload (workflow sample data + employee
    // name/role + recipient_type + new_pm_name so the conditional templates render) —
    // caller-provided data still wins (explicit test values), so the prefilled sample's
    // recipient_type drives the preview. Greeting comes from $recipient.name.
    const payload = {
      ...base,
      employee_name: emp.name,
      role: emp.role ?? "",
      recipient_type: typeForRole(emp.role),
      new_pm_name: getProjectPmName(tenant),
      ...(data ?? {}),
    };

    if (isEvent && eventName) {
      await trackEvent(ws, emp.distinctId, eventName, payload, tenant);
    } else {
      await triggerWorkflow(ws, workflow_slug, emp.distinctId, payload, tenant);
    }

    return NextResponse.json({ ok: true, recipient: emp.name, email: emp.email, via: isEvent ? "event" : "api" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
