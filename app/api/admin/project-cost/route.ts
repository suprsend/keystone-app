import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import { getProjectCost, setProjectCost } from "@/lib/server/users";
import { triggerObjectWorkflow } from "@/lib/server/hub";

// A project's Cost / Budget lives as a property on the project OBJECT (SuprSend),
// alongside its state and role subscriptions. It is the value the Project Started /
// Paused workflows compare against the category's `Cost > N` threshold, so the gate
// is sourced from the stored object property — never invented in app code.

export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tParam = new URL(req.url).searchParams.get("tenant");
    const tenant = tParam || (await getActiveTenant());
    const cost = await getProjectCost(ws, tenant);
    return NextResponse.json({ ok: true, cost });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const active = await getActiveTenant();
    const { tenant, cost } = (await req.json()) as { tenant?: string; cost?: number | string };
    const projectId = typeof tenant === "string" && tenant ? tenant : active;
    const n = Number(cost);
    if (cost === "" || cost === null || cost === undefined || !Number.isFinite(n) || n < 0) {
      return NextResponse.json({ ok: false, error: "A non-negative Cost is required" }, { status: 400 });
    }
    await setProjectCost(ws, projectId, n);
    // Fire Budget Alert on the project OBJECT on every save. SuprSend decides whether
    // to deliver (condition: cost > the category's budget ceiling) and to whom (role:
    // PM/Sponsor/Process Owner) — the app only supplies the cost; no recipient logic.
    await triggerObjectWorkflow(
      ws,
      { workflow: "budget-alert", objectType: "project", objectId: projectId, data: { cost: n, project_link: `https://app.keystone.com/projects/${projectId}` } },
      projectId,
    ).catch(() => {});
    return NextResponse.json({ ok: true, cost: n });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
