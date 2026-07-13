import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { errMsg } from "@/lib/server/http";
import { getActiveTenant, getActiveWorkspace } from "@/lib/server/workspace";
import { trackEvent, triggerObjectWorkflow, triggerWorkflow } from "@/lib/server/hub";
import { getWorkspaceData, mutate, type CollectionKey, type Op } from "@/lib/server/workspace-data";

// GET — the schema + rows for the active project's collections (the editable grid).
export async function GET() {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    return NextResponse.json({ ok: true, ...getWorkspaceData(ws.slug, tenant) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

// POST — a CRUD mutation (insert/update/delete). The store diffs the change and
// returns the notifications it triggers; we fire each per recipient (track_event,
// tenant-scoped) with that recipient's own data. The actor is the "Viewing as"
// person (excluded from their own action inside the trigger engine).
export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tenant = await getActiveTenant();
    const body = await req.json();
    // Actor = who performed the change (excluded from their own notifications).
    // User view sends the current user's id; Admin view sends "" (an overseer, not
    // a project member, so nobody is excluded). Fallback: the impersonation cookie.
    const actorId = typeof body.actorId === "string" ? body.actorId : ((await cookies()).get("actor")?.value ?? "");
    const result = mutate(
      tenant,
      { collection: body.collection as CollectionKey, op: body.op as Op, id: body.id, values: body.values ?? {} },
      actorId,
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    // RECIPIENT RESOLUTION IS OUTSOURCED TO SUPRSEND. The app no longer mirrors its
    // store into SuprSend's users/objects on every edit — the project OBJECT (seeded
    // by scripts/provision.mjs) is the single source of who's on a project. So there
    // is no upsertUser/subscribeUserToProject/roleSync here anymore.
    //
    // Fire each planned event:
    //  • object     — trigger the project object; SuprSend fans out to its subscribers
    //                 and the workflow's role conditions select who actually gets it.
    //  • individual — trigger the workflow for the specific person(s) the action names
    //                 (assignee, @mentioned, new/previous PM). Data still comes from
    //                 SuprSend's model in templates; we pass only event deltas.
    //  • signal     — a tracked event the workflow listens for (TASK_CLOSED → cancel a
    //                 reminder); not a notification, so it's omitted from the summary.
    const fired: {
      event: string; mode: string; roles?: string[];
      recipients: { name: string; email: string; role: string; recipientType: string; delivered: boolean }[];
    }[] = [];
    for (const ev of result.events) {
      if (ev.mode === "object") {
        await triggerObjectWorkflow(ws, { workflow: ev.workflow, objectType: "project", objectId: tenant, data: ev.data }, tenant).catch(() => {});
        fired.push({ event: ev.event, mode: "object", roles: ev.roles ?? [], recipients: [] });
        continue;
      }
      if (ev.sends.length === 0) continue;
      if (ev.mode === "signal") {
        await Promise.allSettled(ev.sends.map((s) => trackEvent(ws, s.distinctId, ev.event, s.payload, tenant)));
        continue;
      }
      const outcomes = await Promise.allSettled(ev.sends.map((s) => triggerWorkflow(ws, ev.workflow, s.distinctId, s.payload, tenant)));
      fired.push({
        event: ev.event, mode: "individual",
        recipients: ev.sends.map((s, i) => ({
          name: s.name, email: s.email, role: s.role, recipientType: s.recipientType,
          delivered: outcomes[i].status === "fulfilled",
        })),
      });
    }

    // Return the UPDATED view computed on THIS instance (same request as the write),
    // so the client reflects the change without a separate GET — which on Vercel's
    // serverless runtime could hit a different (stale) instance and "revert" the edit.
    return NextResponse.json({ ok: true, message: result.message, fired, view: getWorkspaceData(ws.slug, tenant) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
