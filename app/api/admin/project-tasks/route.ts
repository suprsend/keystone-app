import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import { triggerObjectWorkflow, trackEvent } from "@/lib/server/hub";
import { listUsers, getProjectRoles } from "@/lib/server/users";
import { getTasks, addTask, setTaskStatus, TASK_STATUSES } from "@/lib/server/project-content";
import { getTenantPrefExtras } from "@/lib/server/tenant-prefs";

// Excluded distinct_ids (the "Except" condition) passed in the trigger data so the
// workflow's condition node can filter them out. Fetched per preference category.
async function exceptOf(ws: import("@/lib/workspaces").WorkspaceSlug, tenant: string, category: string): Promise<string[]> {
  return (await getTenantPrefExtras(ws, tenant, category).catch(() => ({ except: [] as string[] }))).except ?? [];
}

const PM_ROLE = "Project Manager";
// tasks-upcoming is an EVENT-triggered workflow (not api) — adding a task emits this
// event for the assignee; the workflow's wait-until schedules the reminder. Completing
// emits TASK_CLOSED, which the wait-until matches (by task_id) to cancel the reminder.
const TASKS_UPCOMING_EVENT = "TASKS_UPCOMING";
const TASK_CLOSED_EVENT = "TASK_CLOSED";

function human(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

async function resolveTenant(body?: { tenant?: string }) {
  const t = body?.tenant;
  return typeof t === "string" && t ? t : await getActiveTenant();
}

// GET — tasks for a project + the members (for assignee names / pickers / PM detection).
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tParam = new URL(req.url).searchParams.get("tenant");
    const tenant = tParam || (await getActiveTenant());
    const [tasks, users, roles] = await Promise.all([getTasks(ws, tenant), listUsers(ws), getProjectRoles(ws, tenant)]);
    const members = Object.keys(roles).map((id) => ({
      distinctId: id,
      name: users.find((u) => u.distinctId === id)?.name ?? id,
      role: roles[id],
    }));
    return NextResponse.json({ ok: true, tasks, members });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

// POST — add a task, then fire Tasks Coming Up to the assignee. The
// reminder is EVENT-BASED: one trigger now; the workflow's wait-until schedules the
// send relative to due_date. No cron, and due-date changes aren't handled (by design).
export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const body = (await req.json()) as { tenant?: string; name?: string; assigneeId?: string; dueDate?: string };
    const tenant = await resolveTenant(body);
    const name = (body.name ?? "").trim();
    const assigneeId = body.assigneeId ?? "";
    const dueDate = body.dueDate ?? "";
    if (!name || !assigneeId || !dueDate) {
      return NextResponse.json({ ok: false, error: "name, assignee and due date are required" }, { status: 400 });
    }
    const task = await addTask(ws, tenant, { name, assigneeId, dueDate });
    // The tasks-upcoming wait-until delay pivots on `.due_date` and REQUIRES a full
    // ISO-8601 timestamp (e.g. 2026-06-22T00:00:00Z) — a date-only value fails the
    // node. A date-only input gets midnight-UTC appended; a full timestamp is kept.
    const dueDateIso = /\d{4}-\d{2}-\d{2}T/.test(dueDate) ? dueDate : `${dueDate}T00:00:00Z`;
    // EVENT trigger (track_event) — the event workflow's wait-until schedules the
    // reminder relative to due_date. (Event workflows don't run via workflows.trigger.)
    await trackEvent(
      ws,
      assigneeId,
      TASKS_UPCOMING_EVENT,
      {
        project_id: tenant,
        project_link: `https://app.keystone.com/projects/${tenant}`,
        task_id: task.id,
        task_name: name,
        due_date: dueDateIso,
        due_date_display: human(dueDate),
        except: await exceptOf(ws.slug, tenant, "tasks-coming-up"),
      },
      tenant,
    ).catch(() => {});
    return NextResponse.json({ ok: true, task });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

// PATCH — change a task's status. A user may only complete their OWN task; the PM (and
// admin overseer) may change anyone's. Completing fires Task Completed to
// the PM only — resolved from the project object's current PM subscription.
export async function PATCH(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const body = (await req.json()) as { tenant?: string; taskId?: string; status?: string };
    const tenant = await resolveTenant(body);
    const { taskId, status } = body;
    if (!taskId || !status || !TASK_STATUSES.includes(status)) {
      return NextResponse.json({ ok: false, error: "taskId and a valid status are required" }, { status: 400 });
    }

    const [tasks, roles] = await Promise.all([getTasks(ws, tenant), getProjectRoles(ws, tenant)]);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });

    const actor = (await cookies()).get("actor")?.value ?? "";
    const pmId = Object.keys(roles).find((id) => roles[id] === PM_ROLE) ?? "";
    const isPm = actor === pmId;
    const isAdmin = actor === "admin" || actor === "";
    const isOwner = actor === task.assigneeId;
    if (!isOwner && !isPm && !isAdmin) {
      return NextResponse.json({ ok: false, error: "Only the assignee or the PM can change this task." }, { status: 403 });
    }

    await setTaskStatus(ws, tenant, taskId, status);

    // Completing cancels the assignee's pending Tasks Coming Up reminder (the
    // wait-until matches this TASK_CLOSED event by task_id on their timeline).
    if (status === "Completed") {
      await trackEvent(ws, task.assigneeId, TASK_CLOSED_EVENT, { task_id: taskId }, tenant).catch(() => {});
    }

    // Task Completed → fire on the project OBJECT. SuprSend fans out to subscribers;
    // narrowing to the PM is a preference condition on the workflow (added in staging),
    // NOT resolved here. Until then it goes to everyone subscribed (accepted limitation).
    if (status === "Completed") {
      const users = await listUsers(ws);
      await triggerObjectWorkflow(
        ws,
        {
          workflow: "task-completed",
          objectType: "project",
          objectId: tenant,
          data: {
            project_id: tenant,
            project_link: `https://app.keystone.com/projects/${tenant}`,
            task_name: task.name,
            task_assignee: users.find((u) => u.distinctId === task.assigneeId)?.name ?? task.assigneeId,
            except: await exceptOf(ws.slug, tenant, "task-completed"),
          },
        },
        tenant,
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
