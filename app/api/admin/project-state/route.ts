import { NextResponse } from "next/server";
import { errMsg, projectLink } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import { triggerObjectWorkflow } from "@/lib/server/hub";
import { getProjectState, setProjectState, getProjectCost, PROJECT_STATES } from "@/lib/server/users";
import { getTenantPrefExtras } from "@/lib/server/tenant-prefs";

// A project's lifecycle state lives as a property on the project OBJECT (SuprSend).
// Changing it to In-flight / Paused fires the matching workflow ON THE OBJECT, so
// SuprSend fans out to the project's subscribers. Completed fires nothing.
const STATE_WORKFLOW: Record<string, string> = {
  "In-flight": "project-started",
  Paused: "project-paused",
};

export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tParam = new URL(req.url).searchParams.get("tenant");
    const tenant = tParam || (await getActiveTenant());
    const state = await getProjectState(ws, tenant);
    return NextResponse.json({ ok: true, state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const active = await getActiveTenant();
    const { tenant, state } = (await req.json()) as { tenant?: string; state?: string };
    if (!state || !PROJECT_STATES.includes(state)) {
      return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 400 });
    }
    const projectId = typeof tenant === "string" && tenant ? tenant : active;

    // No-op if unchanged (don't re-fire on a redundant set).
    const current = await getProjectState(ws, projectId);
    if (current === state) return NextResponse.json({ ok: true, state, fired: null });

    await setProjectState(ws, projectId, state);

    // Fire the matching workflow ON THE OBJECT — SuprSend resolves the recipients.
    const workflow = STATE_WORKFLOW[state];
    if (workflow) {
      // Pass the "Except" distinct_ids in the trigger data so the workflow can filter
      // them out (workflow slug == preference category slug for these).
      const except = (await getTenantPrefExtras(ws.slug, projectId, workflow).catch(() => ({ except: [] as string[] }))).except ?? [];
      // The project's Cost / Budget (from the object) rides along so the workflow's
      // `cost > $category.properties.cost` condition can gate the send. Below the
      // threshold (or unset) → the condition fails → nobody is notified. Sourced from
      // the stored object property, never invented here.
      const cost = await getProjectCost(ws, projectId).catch(() => null);
      await triggerObjectWorkflow(
        ws,
        {
          workflow,
          objectType: "project",
          objectId: projectId,
          data: {
            project_id: projectId,
            project_link: projectLink(req, projectId),
            except,
            ...(cost !== null ? { cost } : {}),
          },
        },
        projectId,
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true, state, fired: workflow ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
