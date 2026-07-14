// Live employees = SuprSend subscribers (the Users tab). Backed entirely by the
// hub user API via the node SDK — list / get / add (upsert) / remove (delete).
// Role + name live in user `properties`; email is the `$email` channel.
import "server-only";
import type { Workspace } from "@/lib/workspaces";
import { suprsendClient as client, hasWorkspaceKeys, getActiveTenant } from "@/lib/server/workspace";

// Event emitted when a new employee is added. An event-triggered workflow
// (`event-employee-onboarding`, trigger_type:"event") listens for it and fires
// onboarding automatically — no manual Send test. SuprSend upper-cases the name.
export const ONBOARDING_EVENT = "employee_onboarded";

// A static list every employee joins on creation. Powers list-based delivery:
// broadcasts (one template to the whole company) and list-entry triggers.
export const ALL_EMPLOYEES_LIST = "all-employees";

/** Add a user to the all-employees list (idempotent). Best-effort. */
export async function addToAllEmployeesList(ws: Workspace, distinctId: string) {
  return client(ws).subscriber_lists.add(ALL_EMPLOYEES_LIST, [distinctId]);
}

export interface WorkUser {
  distinctId: string;
  name: string;
  email: string | null;
  role: string | null;
  hasInbox: boolean;
  hasSlack: boolean;
  createdAt: string | null;
}

interface RawUser {
  distinct_id: string;
  properties?: { name?: string; role?: string };
  $email?: { value?: string }[];
  $inbox?: unknown[];
  $slack?: unknown[];
  created_at?: string;
}

function shape(u: RawUser): WorkUser {
  return {
    distinctId: u.distinct_id,
    name: u.properties?.name ?? u.distinct_id,
    email: u.$email?.[0]?.value ?? null,
    role: u.properties?.role ?? null,
    hasInbox: Array.isArray(u.$inbox) && u.$inbox.length > 0,
    hasSlack: Array.isArray(u.$slack) && u.$slack.length > 0,
    createdAt: u.created_at ?? null,
  };
}

export async function listUsers(ws: Workspace): Promise<WorkUser[]> {
  if (!hasWorkspaceKeys(ws)) return [];
  const res = (await client(ws).users.list({ limit: 100 })) as { results?: RawUser[] };
  return (res.results ?? [])
    .map(shape)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export async function getUser(ws: Workspace, distinctId: string): Promise<WorkUser | null> {
  if (!hasWorkspaceKeys(ws)) return null;
  try {
    const u = (await client(ws).users.get(distinctId)) as RawUser;
    return u?.distinct_id ? shape(u) : null;
  } catch {
    return null;
  }
}

/** Add or update an employee: sets email + name + role. (Slack/Teams delivery is not
 *  wired — the third channel is display-only; Keystone uses Teams, not Slack.) */
export async function upsertUser(
  ws: Workspace,
  distinctId: string,
  data: { name?: string; email?: string; role?: string },
) {
  const c = client(ws);
  const edit = c.users.get_edit_instance(distinctId);
  if (data.email) edit.add_email(data.email);
  const props: Record<string, string> = {};
  if (data.name) props.name = data.name;
  if (data.role) props.role = data.role;
  if (Object.keys(props).length) edit.set(props);
  return c.users.edit(edit);
}

export async function removeUser(ws: Workspace, distinctId: string) {
  return client(ws).users.delete(distinctId);
}

// The object type for projects (project = object; members subscribed with a `role`
// property — drives object fan-out + project membership). Mirrors scripts/provision.mjs.
const PROJECT_OBJECT = "project";

/** The projects that EXIST in this workspace — read from SuprSend (the project
 * objects), not a hardcoded list. id = object id (= tenant id), name = object name. */
export async function listProjects(ws: Workspace): Promise<{ id: string; name: string }[]> {
  if (!hasWorkspaceKeys(ws)) return [];
  try {
    const res = (await client(ws).objects.list(PROJECT_OBJECT, { limit: 100 })) as {
      results?: { object_id?: string; id?: string; properties?: { name?: string } }[];
    };
    return (res.results ?? [])
      .map((o) => ({ id: o.object_id ?? o.id ?? "", name: o.properties?.name ?? o.object_id ?? o.id ?? "" }))
      .filter((p) => p.id);
  } catch {
    return [];
  }
}

/** Create a new project: the SuprSend OBJECT (membership) + the TENANT (brand), then
 * subscribe the chosen people with their roles. The object id IS the tenant id. Brand
 * upsert is best-effort (a project still works without per-project brand). */
export async function createProject(
  ws: Workspace,
  opts: { id: string; name: string; members: { distinctId: string; role: string }[] },
) {
  const c = client(ws);
  await c.objects.upsert(PROJECT_OBJECT, opts.id, { name: opts.name, state: "In-flight" });
  // Inherit the customer's brand from the `default` tenant (logo + colours + links) so
  // the new project's notifications look consistent — read live, no per-project hardcoding.
  const def = (await c.tenants.get("default").catch(() => null)) as {
    logo?: string;
    primary_color?: string;
    secondary_color?: string;
    tertiary_color?: string;
    social_links?: Record<string, string>;
  } | null;
  await c.tenants
    .upsert(opts.id, {
      tenant_name: opts.name,
      ...(def?.logo ? { logo: def.logo } : {}),
      ...(def?.primary_color ? { primary_color: def.primary_color } : {}),
      ...(def?.secondary_color ? { secondary_color: def.secondary_color } : {}),
      ...(def?.tertiary_color ? { tertiary_color: def.tertiary_color } : {}),
      ...(def?.social_links ? { social_links: def.social_links } : {}),
    })
    .catch(() => {});
  for (const m of opts.members) {
    await c.objects.create_subscriptions(PROJECT_OBJECT, opts.id, {
      recipients: [m.distinctId],
      properties: { role: m.role },
    });
  }
}

/** Subscribe a user to a project object with their role (idempotent — also used to
 * CHANGE the role: re-subscribing upserts the subscription's `role` property). */
export async function subscribeUserToProject(ws: Workspace, projectId: string, distinctId: string, role: string) {
  return client(ws).objects.create_subscriptions(PROJECT_OBJECT, projectId, {
    recipients: [distinctId],
    properties: { role },
  });
}

/** Remove a user from a project object (delete their subscription). */
export async function unsubscribeUserFromProject(ws: Workspace, projectId: string, distinctId: string) {
  return client(ws).objects.delete_subscriptions(PROJECT_OBJECT, projectId, { recipients: [distinctId] });
}

// Roles that exactly ONE person can hold on a project (Keystone's real model — a
// project has a single PM, Process Owner, Sponsor). Team Member is the open role.
export const SINGLE_ROLES = ["Project Manager", "Process Owner", "Project Sponsor"];

// A project's lifecycle state. Lives as a PROPERTY ON THE PROJECT OBJECT (SuprSend),
// not in our backend. In-flight = started, Paused, Completed. In-flight and Paused
// drive the Project Started / Project Paused workflows.
export const PROJECT_STATES = ["In-flight", "Paused", "Completed"];

/** Read a project's state from the project object's properties (defaults to In-flight). */
export async function getProjectState(ws: Workspace, projectId: string): Promise<string> {
  if (!hasWorkspaceKeys(ws)) return "In-flight";
  try {
    const o = (await client(ws).objects.get(PROJECT_OBJECT, projectId)) as { properties?: { state?: string } };
    return o?.properties?.state ?? "In-flight";
  } catch {
    return "In-flight";
  }
}

/** Write a project's state onto the project object (the source of truth). */
export async function setProjectState(ws: Workspace, projectId: string, state: string) {
  return client(ws).objects.upsert(PROJECT_OBJECT, projectId, { state });
}

/**
 * A project's Cost / Budget — a single number stored on the project OBJECT (same
 * place as state/role subscriptions). It is the value the Project Started / Paused
 * cost condition compares against the category's `Cost > N` threshold. Returns
 * null when unset. Read live from the object so the gate is never invented in app code.
 */
export async function getProjectCost(ws: Workspace, projectId: string): Promise<number | null> {
  if (!hasWorkspaceKeys(ws)) return null;
  try {
    const o = (await client(ws).objects.get(PROJECT_OBJECT, projectId)) as { properties?: { cost?: number | string } };
    const raw = o?.properties?.cost;
    if (raw === undefined || raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Write a project's Cost / Budget onto the project object (the source of truth). */
export async function setProjectCost(ws: Workspace, projectId: string, cost: number) {
  return client(ws).objects.upsert(PROJECT_OBJECT, projectId, { cost });
}

/**
 * Assign `distinctId` to `role` on the project object. For a single-occupancy role,
 * the previous holder is REMOVED FROM THE PROJECT (so a project never has two PMs).
 * Returns the ids that were removed — the caller surfaces them ("X removed as PM").
 * Clearing a slot without a replacement is a separate action (the UI demotes that
 * holder to Team Member) and never reaches here with a single role, so removal only
 * happens on a genuine replacement. The object stays the source of truth.
 */
export async function assignProjectRole(
  ws: Workspace,
  projectId: string,
  distinctId: string,
  role: string,
): Promise<{ removed: string[] }> {
  const removed: string[] = [];
  if (SINGLE_ROLES.includes(role)) {
    const roles = await getProjectRoles(ws, projectId);
    for (const [id, r] of Object.entries(roles)) {
      if (r === role && id !== distinctId) {
        await unsubscribeUserFromProject(ws, projectId, id);
        removed.push(id);
      }
    }
  }
  await subscribeUserToProject(ws, projectId, distinctId, role);
  return { removed };
}

interface SubscriptionRow {
  properties?: { role?: string };
  user?: { distinct_id?: string };
}

/**
 * Per-project roles, read from the PROJECT OBJECT's subscriptions. Role is a
 * property of the subscription (NOT the user) — a user can be on multiple projects
 * with different roles, so the global user prop isn't used. distinct_id → role.
 */
export async function getProjectRoles(ws: Workspace, projectId: string): Promise<Record<string, string>> {
  if (!hasWorkspaceKeys(ws)) return {};
  try {
    const res = (await client(ws).objects.get_subscriptions(PROJECT_OBJECT, projectId, { limit: 100 })) as {
      results?: SubscriptionRow[];
    };
    const map: Record<string, string> = {};
    for (const r of res.results ?? []) {
      const id = r.user?.distinct_id;
      const role = r.properties?.role;
      if (id && role) map[id] = role;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * ALL project-object subscribers, INCLUDING those with no role (value ""). Unlike
 * getProjectRoles (which drops role-less subs), this reflects true object membership
 * so the Resources "Others" bucket can show watchers / blank-role CC subscribers —
 * people on the object so SuprSend fans out to them, who aren't formal team members.
 */
export async function getProjectSubscribers(ws: Workspace, projectId: string): Promise<Record<string, string>> {
  if (!hasWorkspaceKeys(ws)) return {};
  try {
    const res = (await client(ws).objects.get_subscriptions(PROJECT_OBJECT, projectId, { limit: 100 })) as {
      results?: SubscriptionRow[];
    };
    const map: Record<string, string> = {};
    for (const r of res.results ?? []) {
      const id = r.user?.distinct_id;
      if (id) map[id] = r.properties?.role ?? "";
    }
    return map;
  } catch {
    return {};
  }
}

// What an employee is subscribed to: team objects + subscriber lists. Surfaced in
// the Users tab so the object/list (subscription) model is visible in the app.
export interface UserSubscriptions {
  teams: { id: string; type: string; name: string }[];
  lists: { id: string; name: string }[];
}

export async function getUserSubscriptions(ws: Workspace, distinctId: string): Promise<UserSubscriptions> {
  if (!hasWorkspaceKeys(ws)) return { teams: [], lists: [] };
  const c = client(ws);
  type ObjRes = { results?: { object?: { id?: string; object_type?: string; properties?: { name?: string } } }[] };
  type ListRes = { results?: { list?: { list_id?: string; list_name?: string } }[] };
  const [objs, lists] = await Promise.all([
    c.users.get_objects_subscribed_to(distinctId).catch(() => ({ results: [] }) as ObjRes) as Promise<ObjRes>,
    c.users.get_lists_subscribed_to(distinctId).catch(() => ({ results: [] }) as ListRes) as Promise<ListRes>,
  ]);
  return {
    teams: (objs.results ?? []).map((r) => ({
      id: r.object?.id ?? "",
      type: r.object?.object_type ?? "team",
      name: r.object?.properties?.name ?? r.object?.id ?? "",
    })).filter((t) => t.id),
    lists: (lists.results ?? []).map((r) => ({
      id: r.list?.list_id ?? "",
      name: r.list?.list_name ?? r.list?.list_id ?? "",
    })).filter((l) => l.id),
  };
}
