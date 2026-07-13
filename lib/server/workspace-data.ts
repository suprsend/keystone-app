// Workspace Data — a small but REAL database layer for the demo: typed
// collections (projects, people, tasks, comments) with full CRUD, plus a
// declarative change→event TRIGGER engine. You edit a row like a spreadsheet;
// the engine diffs old vs new and fires whatever notifications that change maps
// to — exactly how database triggers / change-data-capture work.
//
// Scaling story: a new entity = a new schema + seed; a new notification = a new
// rule in TRIGGERS. No bespoke handler or button per case. No-op guards and
// "previous value" (e.g. the previous PM) come from the diff for free.
//
// Scope: keyed by project (tenant). Module-level singleton on globalThis so it
// survives dev hot-reloads; it RESETS when the dev server restarts.
//
// EMAIL SAFETY: recipients are roster people whose emails are already
// plus-addressed to the one inbox we control (lib/people.ts).
import "server-only";
import type { TenantId } from "@/lib/tenants";
import { getTenant } from "@/lib/tenants";
import { getRoster, getProjectManager, type PersonRole } from "@/lib/people";
import { safeEmail } from "@/lib/safe-email";

// ── Schema primitives (sent to the client so the grid renders generically) ────
export type ColumnType = "readonly" | "text" | "enum" | "ref" | "datetime";
export interface Column {
  key: string;
  label: string;
  type: ColumnType;
  /** enum options */
  options?: string[];
  /** ref → a person picker (value = person id) */
  ref?: "people";
  editable: boolean;
}
export type Row = Record<string, string>;
export interface Collection {
  key: CollectionKey;
  label: string;
  /** Singular noun for the "Add …" control. */
  noun: string;
  columns: Column[];
  rows: Row[];
  canInsert: boolean;
  canDelete: boolean;
}
export type CollectionKey = "projects" | "people" | "tasks" | "comments";
export type Op = "insert" | "update" | "delete";

// Events that are internal SIGNALS (no template, no email) — fired only to drive
// workflow logic (e.g. TASK_CLOSED cancels a reminder). Excluded from the
// "who was notified" summary so they don't look like notifications.
export const INTERNAL_EVENTS = new Set<string>(["TASK_CLOSED"]);

// How each notification reaches its recipients (mirrors scripts/provision.mjs):
//  • OBJECT  — triggered with the project OBJECT as recipient; SuprSend fans out to
//    its subscribers and its role conditions select who gets it. Recipient
//    resolution is OUTSOURCED to SuprSend — the app does NOT compute the list.
//  • SIGNAL  — a tracked event the workflow listens for (TASK_CLOSED → reminder cancel).
//  • INDIVIDUAL (default) — the recipient is determined by the ACTION (the assignee,
//    the @mentioned person, the new/previous PM); SuprSend can't infer that from the
//    object, so the app triggers the workflow to the specific person(s).
export type FireMode = "object" | "individual" | "signal";
const OBJECT_EVENTS = new Set<string>(["PROJECT_STARTED", "PROJECT_PAUSED", "COMMENT_ADDED", "TASK_COMPLETED"]);
// Roles SuprSend keeps on each object fan-out (display only — the real filter lives
// in the workflow's conditions; this just labels the toast). Mirror of ROLE_CONDITIONS.
const OBJECT_ROLES: Record<string, string[]> = {
  PROJECT_STARTED: ["Project Manager", "Team Member", "Project Sponsor"],
  PROJECT_PAUSED: ["Team Member", "Project Sponsor"],
  COMMENT_ADDED: ["Project Manager", "Team Member"],
  TASK_COMPLETED: ["Project Manager"],
};
// Engine event name → live workflow slug (PROJECT_STARTED → project-started).
export const workflowSlugOf = (event: string) => event.toLowerCase().replace(/_/g, "-");
const fireModeOf = (event: string): FireMode =>
  INTERNAL_EVENTS.has(event) ? "signal" : OBJECT_EVENTS.has(event) ? "object" : "individual";

export interface PersonOption {
  id: string;
  label: string;
}
export interface WorkspaceDataView {
  collections: Collection[];
  /** Person options for ref columns, by project (the active project's people). */
  peopleOptions: PersonOption[];
}

// ── One notification the engine fires (resolved recipients + payloads) ────────
export interface PlannedSend {
  distinctId: string;
  name: string;
  email: string;
  role: string;
  recipientType: string;
  payload: Record<string, unknown>;
}
export interface FiredEvent {
  event: string;
  /** Live workflow slug to trigger (project-started, tagged-on-project, …). */
  workflow: string;
  /** How it's delivered — object fan-out, per-person, or an internal signal. */
  mode: FireMode;
  /** Event/project-level payload (deltas only). Recipient + brand data come from
   * SuprSend's model ({{$recipient.*}} / {{$brand.*}}), not from here. */
  data: Record<string, unknown>;
  /** Roles SuprSend filters the object fan-out to (object mode only; for display). */
  roles?: string[];
  /** Resolved per-person sends (individual + signal modes only). Empty for object. */
  sends: PlannedSend[];
}
export interface MutationResult {
  ok: boolean;
  error?: string;
  /** Human summary of the data change. */
  message: string;
  events: FiredEvent[];
  /** The affected person (people CRUD only) — so the route can provision the live
   * SuprSend user (insert), update them (role/name), or remove them (delete). */
  person?: { id: string; name: string; email: string; role: string; op: Op };
  /** Role changes to mirror onto the live SuprSend users (e.g. PM reassignment
   * demotes the old PM and promotes the new one — keeps roles consistent everywhere). */
  roleSync?: { id: string; role: string }[];
}

// ── State ─────────────────────────────────────────────────────────────────────
export type ProjectStatus = "Not started" | "In-flight" | "Paused";
export type TaskStatus = "To do" | "In progress" | "Done";
export const PROJECT_STATUSES: ProjectStatus[] = ["Not started", "In-flight", "Paused"];
export const TASK_STATUSES: TaskStatus[] = ["To do", "In progress", "Done"];
export const PERSON_ROLES: PersonRole[] = ["Project Manager", "Team Member", "Project Sponsor", "Process Owner"];

interface PersonRow { id: string; name: string; role: PersonRole; email: string }
interface TaskRow { id: string; name: string; assigneeId: string; dueDate: string; status: TaskStatus }
interface CommentRow { id: string; authorId: string; body: string; mentionId: string; createdAt: string }
interface ProjectState {
  status: ProjectStatus;
  pmId: string;
  /** The PM before the most recent reassignment ("" if never reassigned). Persisted
   * so the UI can SHOW who the previous PM was and why they got the "removed" email. */
  previousPmId: string;
  people: PersonRow[];
  tasks: TaskRow[];
  comments: CommentRow[];
}

const SEED_STATUS: Record<string, ProjectStatus> = {
  "honeywell-aero": "Not started",
  "honeywell-bms": "In-flight",
  "hsy-reeses": "Not started",
  "hsy-kisses": "Paused",
};

const human = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
};

function seed(tenant: TenantId): ProjectState {
  const roster = getRoster(tenant);
  const people: PersonRow[] = roster.map((p) => ({ id: p.id, name: p.name, role: p.role, email: p.email }));
  const members = people.filter((p) => p.role === "Team Member");
  const owner = people.find((p) => p.role === "Process Owner");
  const sponsor = people.find((p) => p.role === "Project Sponsor");
  const now = Date.now();
  return {
    status: SEED_STATUS[tenant] ?? "Not started",
    pmId: getProjectManager(tenant)?.id ?? people[0]?.id ?? "",
    previousPmId: "",
    people,
    // One OPEN task per team member so whoever you view as has something to complete,
    // plus one Done row for variety. members[0/1/2] = the three team members.
    tasks: [
      { id: `task_${tenant}_1`, name: "Design FMEA review", assigneeId: members[0]?.id ?? "", dueDate: inDays(9), status: "In progress" },
      { id: `task_${tenant}_2`, name: "Submit gate deliverables", assigneeId: members[1]?.id ?? "", dueDate: inDays(12), status: "To do" },
      { id: `task_${tenant}_3`, name: "Supplier qualification", assigneeId: members[2]?.id ?? "", dueDate: inDays(4), status: "In progress" },
      { id: `task_${tenant}_4`, name: "Prototype build v1", assigneeId: members[0]?.id ?? "", dueDate: inDays(2), status: "Done" },
    ],
    comments: [
      { id: `cmt_${tenant}_1`, authorId: owner?.id ?? "", body: "Pushed the latest FMEA — can you review section 3?", mentionId: "", createdAt: new Date(now - 18e6).toISOString() },
      { id: `cmt_${tenant}_2`, authorId: sponsor?.id ?? "", body: "Budget for the next gate is approved.", mentionId: "", createdAt: new Date(now - 7e6).toISOString() },
    ],
  };
}

const g = globalThis as unknown as { __wsData?: Record<string, ProjectState> };
function store(): Record<string, ProjectState> {
  if (!g.__wsData) g.__wsData = {};
  return g.__wsData;
}
function state(tenant: TenantId): ProjectState {
  const s = store();
  if (!s[tenant]) s[tenant] = seed(tenant);
  return s[tenant];
}
function personOf(st: ProjectState, id: string): PersonRow | undefined {
  return st.people.find((p) => p.id === id);
}
function nameOf(st: ProjectState, id: string): string {
  return personOf(st, id)?.name ?? "—";
}

// ── Project membership accessors (the store IS the per-project roster now) ──────
// So the Users tab, "Viewing as", Test-panel roster and role-filtered fan-out all
// agree with Workspace Data — incl. people added/removed/role-changed in the grid.
export function getProjectPeople(tenant: TenantId): { id: string; name: string; role: PersonRole; email: string }[] {
  return state(tenant).people.map((p) => ({ id: p.id, name: p.name, role: p.role, email: p.email }));
}
export function getProjectPmName(tenant: TenantId): string {
  const s = state(tenant);
  return personOf(s, s.pmId)?.name ?? "";
}

// ── View (schema + rows) ──────────────────────────────────────────────────────
export function getWorkspaceData(workspace: string, tenant: TenantId): WorkspaceDataView {
  const st = state(tenant);
  const peopleOptions: PersonOption[] = st.people.map((p) => ({ id: p.id, label: `${p.name} · ${p.role}` }));

  // Projects table — the active project's record (scoped to the active
  // customer+project, like the rest of the section). Editing its cells fires the
  // status / assignment notifications. `workspace` reserved for future multi-row.
  void workspace;
  const projectRows: Row[] = [{ id: tenant, name: getTenant(tenant).label, status: st.status, pmId: st.pmId, previousPmId: st.previousPmId }];

  const collections: Collection[] = [
    {
      key: "projects",
      label: "Projects",
      noun: "project",
      canInsert: false,
      canDelete: false,
      columns: [
        { key: "name", label: "Project", type: "readonly", editable: false },
        { key: "status", label: "Status", type: "enum", options: PROJECT_STATUSES, editable: true },
        { key: "pmId", label: "Project manager", type: "ref", ref: "people", editable: true },
        { key: "previousPmId", label: "Previous PM", type: "ref", ref: "people", editable: false },
      ],
      rows: projectRows,
    },
    {
      key: "people",
      label: "People",
      noun: "person",
      canInsert: true,
      canDelete: true,
      columns: [
        { key: "name", label: "Name", type: "text", editable: true },
        { key: "role", label: "Role", type: "enum", options: PERSON_ROLES, editable: true },
        { key: "email", label: "Email", type: "text", editable: true },
      ],
      rows: st.people.map((p) => ({ id: p.id, name: p.name, role: p.role, email: p.email })),
    },
    {
      key: "tasks",
      label: "Tasks",
      noun: "task",
      canInsert: true,
      canDelete: true,
      columns: [
        { key: "name", label: "Task", type: "text", editable: true },
        { key: "assigneeId", label: "Assignee", type: "ref", ref: "people", editable: true },
        { key: "dueDate", label: "Due date", type: "datetime", editable: true },
        { key: "status", label: "Status", type: "enum", options: TASK_STATUSES, editable: true },
      ],
      rows: st.tasks.map((t) => ({ id: t.id, name: t.name, assigneeId: t.assigneeId, dueDate: t.dueDate, status: t.status })),
    },
    {
      key: "comments",
      label: "Comments",
      noun: "comment",
      canInsert: true,
      canDelete: true,
      columns: [
        { key: "authorId", label: "Author", type: "ref", ref: "people", editable: true },
        { key: "body", label: "Comment", type: "text", editable: true },
        { key: "mentionId", label: "@mention", type: "ref", ref: "people", editable: true },
      ],
      rows: st.comments.map((c) => ({ id: c.id, authorId: c.authorId, body: c.body, mentionId: c.mentionId })),
    },
  ];

  return { collections, peopleOptions };
}

// ── Trigger engine ────────────────────────────────────────────────────────────
// A rule maps a data change to a notification. `when` reads the new row (and the
// previous row, for diffs / no-op guards). `recipients` resolves WHO with their
// relationship `type` (drives per-recipient copy). `extraData`/`exclude` tailor
// the payload and self-action exclusion. Add a notification = add a rule here.
interface TriggerCtx {
  tenant: TenantId;
  st: ProjectState;
  actorId: string;
}
interface Recipient { id: string; type: string }
interface Rule {
  collection: CollectionKey;
  ops: Op[];
  event: string;
  when: (row: Row, prev: Row | undefined) => boolean;
  recipients: (row: Row, prev: Row | undefined, ctx: TriggerCtx) => Recipient[];
  extraData?: (row: Row, prev: Row | undefined, ctx: TriggerCtx) => Record<string, unknown>;
  /** ids to exclude beyond the actor (e.g. a comment's own author). */
  exclude?: (row: Row, prev: Row | undefined, ctx: TriggerCtx) => string[];
  /** Whether to drop the actor (self-action). Default true. A non-notification
   * "signal" event (e.g. TASK_CLOSED, which only cancels reminders) sets false so
   * the actor's OWN reminder is cancelled too. */
  excludeActor?: boolean;
}

const role = (st: ProjectState, ...roles: PersonRole[]): Recipient[] =>
  st.people.filter((p) => roles.includes(p.role)).map((p) => ({ id: p.id, type: roleType(p.role) }));
const roleType = (r: PersonRole) => r.toLowerCase().replace(/[^a-z0-9]+/g, "_");

const TRIGGERS: Rule[] = [
  // Project manager changed → Project Assigned (per-recipient copy).
  {
    collection: "projects", ops: ["update"], event: "PROJECT_ASSIGNED",
    when: (row, prev) => !!prev && row.pmId !== prev.pmId,
    recipients: (row, prev, { st }) => {
      const list: Recipient[] = [{ id: row.pmId, type: "new_pm" }];
      if (prev?.pmId) list.push({ id: prev.pmId, type: "previous_pm" });
      for (const r of role(st, "Process Owner")) list.push({ id: r.id, type: "process_owner" });
      return list;
    },
    extraData: (row, prev, { st }) => ({ new_pm_name: nameOf(st, row.pmId), previous_pm_name: prev?.pmId ? nameOf(st, prev.pmId) : "" }),
  },
  // Status → In-flight → Project Started (PM + Team + Sponsor).
  {
    collection: "projects", ops: ["update"], event: "PROJECT_STARTED",
    when: (row, prev) => !!prev && row.status === "In-flight" && prev.status !== "In-flight",
    recipients: (row, _p, { st }) => [{ id: row.pmId, type: "project_manager" }, ...role(st, "Team Member", "Project Sponsor")],
  },
  // Status → Paused → Project Paused (Team + Sponsor).
  {
    collection: "projects", ops: ["update"], event: "PROJECT_PAUSED",
    when: (row, prev) => !!prev && row.status === "Paused" && prev.status !== "Paused",
    recipients: (_r, _p, { st }) => role(st, "Team Member", "Project Sponsor"),
  },
  // Task marked Done → Task Completed EMAIL to the PM (actor excluded — a PM who
  // completes it isn't emailed about their own action).
  {
    collection: "tasks", ops: ["update"], event: "TASK_COMPLETED",
    when: (row, prev) => !!prev && row.status === "Done" && prev.status !== "Done",
    recipients: (_r, _p, { st }) => [{ id: st.pmId, type: "project_manager" }],
    extraData: (row, _p, { st }) => ({ task_name: row.name, task_assignee: nameOf(st, row.assigneeId) }),
  },
  // Task marked Done → TASK_CLOSED signal (NOT a notification — no workflow emails
  // on it). Fired to EVERYONE who has a pending Tasks-Coming-Up reminder for this
  // task (assignee + PM) so the Wait-Until cancels each on their OWN timeline. No
  // actor exclusion — even the person who completed it should stop being reminded.
  {
    collection: "tasks", ops: ["update"], event: "TASK_CLOSED",
    when: (row, prev) => !!prev && row.status === "Done" && prev.status !== "Done",
    recipients: (row, _p, { st }) => [{ id: row.assigneeId, type: "assignee" }, { id: st.pmId, type: "project_manager" }],
    extraData: (row) => ({ task_id: row.id }),
    excludeActor: false,
  },
  // New task with a due date → Tasks Coming Up reminder (assignee + PM), scheduled
  // 3 days before the due date (Wait-Until in the live workflow).
  {
    collection: "tasks", ops: ["insert"], event: "TASKS_UPCOMING",
    when: (row) => !!row.dueDate,
    recipients: (row, _p, { st }) => [{ id: row.assigneeId, type: "assignee" }, { id: st.pmId, type: "project_manager" }],
    extraData: (row) => ({ task_id: row.id, task_name: row.name, due_date: row.dueDate, due_date_display: human(row.dueDate) }),
  },
  // New comment → Comment Added (PM + Team), batched per project. Author excluded.
  // A PLAIN comment (no @mention) → Comment Added (batched) to PM + team. A comment
  // that @mentions someone is treated as a TAG instead (urgent), not a comment — so
  // these two are mutually exclusive (a mentioned comment fires ONLY Tagged below).
  {
    collection: "comments", ops: ["insert"], event: "COMMENT_ADDED",
    when: (row) => !row.mentionId,
    recipients: (_r, _p, { st }) => [{ id: st.pmId, type: "project_manager" }, ...role(st, "Team Member")],
    extraData: (row, _p, { st }) => ({ comment_author: nameOf(st, row.authorId), comment_body: row.body }),
    exclude: (row) => [row.authorId],
  },
  // A comment that @mentions someone → Tagged on a Project ONLY (urgent, immediate,
  // to the mentioned person). Does NOT also fire Comment Added.
  {
    collection: "comments", ops: ["insert"], event: "TAGGED_ON_PROJECT",
    when: (row) => !!row.mentionId,
    recipients: (row) => [{ id: row.mentionId, type: "tagged" }],
    extraData: (row, _p, { st }) => ({ actor_name: nameOf(st, row.authorId), comment_body: row.body }),
    exclude: (row) => [row.authorId], // you don't tag yourself
  },
];

function projectBase(tenant: TenantId) {
  // Only project-level deltas. project_name is NOT passed — templates read it from
  // SuprSend's tenant/brand model ({{$brand.tenant_name}}). project_id is the comment
  // batch key; project_link is a project-level constant (same for all recipients).
  return { project_id: tenant, project_link: `https://app.accolade.com/projects/${tenant}` };
}

/** Build the events a change fires. OBJECT-mode events carry only the data payload
 * (SuprSend resolves recipients from the project object + role conditions). INDIVIDUAL
 * and SIGNAL events resolve the specific person(s) the action determines. */
function plan(collection: CollectionKey, op: Op, tenant: TenantId, row: Row, prev: Row | undefined, actorId: string): FiredEvent[] {
  const st = state(tenant);
  const ctx: TriggerCtx = { tenant, st, actorId };
  const events: FiredEvent[] = [];
  for (const rule of TRIGGERS) {
    if (rule.collection !== collection || !rule.ops.includes(op)) continue;
    if (!rule.when(row, prev)) continue;
    const data = { ...projectBase(tenant), ...(rule.extraData?.(row, prev, ctx) ?? {}) };
    const mode = fireModeOf(rule.event);
    const workflow = workflowSlugOf(rule.event);

    // OBJECT: don't resolve recipients — trigger the project object; SuprSend fans
    // out to subscribers and its role conditions pick who gets it.
    if (mode === "object") {
      events.push({ event: rule.event, workflow, mode, data, roles: OBJECT_ROLES[rule.event] ?? [], sends: [] });
      continue;
    }

    // INDIVIDUAL / SIGNAL: target the specific person(s) the action determines.
    const actorDrop = rule.excludeActor === false ? [] : [actorId];
    const drop = new Set([...actorDrop, ...(rule.exclude?.(row, prev, ctx) ?? [])].filter(Boolean));
    const seen = new Set<string>();
    const sends: PlannedSend[] = [];
    for (const rec of rule.recipients(row, prev, ctx)) {
      if (!rec.id || drop.has(rec.id) || seen.has(rec.id)) continue;
      const p = personOf(st, rec.id);
      if (!p) continue;
      seen.add(rec.id);
      // recipient_type drives per-recipient COPY (Project Assigned: new/previous PM,
      // process owner). Name/role come from {{$recipient.*}}, not the payload.
      sends.push({
        distinctId: p.id, name: p.name, email: p.email, role: p.role, recipientType: rec.type,
        payload: { ...data, recipient_type: rec.type },
      });
    }
    events.push({ event: rule.event, workflow, mode, data, sends });
  }
  return events;
}

// ── Mutations (CRUD) ──────────────────────────────────────────────────────────
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}`;

// EMAIL SAFETY (absolute): every demo address is plus-addressed to the one safe inbox
// so it can never reach real people. Policy lives in lib/safe-email.ts (configurable
// via SAFE_TEST_EMAIL_USER / _DOMAIN). Aliased to the existing call-site name.
const resolveSafeEmail = safeEmail;

/**
 * Make `newPmId` the project's PM: record the previous PM, swap roles (old PM →
 * Team Member, new PM → Project Manager), and return the PROJECT_ASSIGNED events +
 * role-sync. A project has exactly ONE PM (pmId), so making someone PM — whether
 * via the Reassign control OR by setting their role to "Project Manager" — is a
 * reassignment that notifies the new PM, the previous PM, and the process owner.
 */
function becomePm(st: ProjectState, tenant: TenantId, newPmId: string, actorId: string): { events: FiredEvent[]; roleSync: { id: string; role: string }[] } {
  const prevPmId = st.pmId;
  const prevRow: Row = { id: tenant, name: getTenant(tenant).label, status: st.status, pmId: prevPmId, previousPmId: st.previousPmId };
  st.previousPmId = prevPmId;
  const oldPm = personOf(st, prevPmId);
  const newPm = personOf(st, newPmId);
  const roleSync: { id: string; role: string }[] = [];
  if (oldPm) { oldPm.role = "Team Member"; roleSync.push({ id: oldPm.id, role: oldPm.role }); }
  if (newPm) { newPm.role = "Project Manager"; roleSync.push({ id: newPm.id, role: newPm.role }); }
  st.pmId = newPmId;
  const row: Row = { id: tenant, name: getTenant(tenant).label, status: st.status, pmId: newPmId, previousPmId: st.previousPmId };
  return { events: plan("projects", "update", tenant, row, prevRow, actorId), roleSync };
}

/**
 * Apply a CRUD mutation and return the notifications it triggers. The route fires
 * them (it owns the SuprSend client). Project rows route by their own tenant id.
 */
export function mutate(
  activeTenant: TenantId,
  input: { collection: CollectionKey; op: Op; id?: string; values?: Record<string, string> },
  actorId: string,
): MutationResult {
  const { collection, op, id, values = {} } = input;

  if (collection === "projects") {
    // Each project row IS a tenant; edits route to that tenant's state.
    const tenant = (id ?? activeTenant) as TenantId;
    const st = state(tenant);
    if (op !== "update") return { ok: false, error: "Projects can only be edited.", message: "", events: [] };
    const label = getTenant(tenant).label;
    // PM reassignment (shared with setting a person's role to PM).
    if (values.pmId && personOf(st, values.pmId) && values.pmId !== st.pmId) {
      const r = becomePm(st, tenant, values.pmId, actorId);
      return { ok: true, message: describe(r.events, `${label} updated`), events: r.events, roleSync: r.roleSync };
    }
    // Status change (or a no-op re-save of the same status).
    const prev: Row = { id: tenant, name: label, status: st.status, pmId: st.pmId, previousPmId: st.previousPmId };
    if (values.status && PROJECT_STATUSES.includes(values.status as ProjectStatus)) st.status = values.status as ProjectStatus;
    const row: Row = { id: tenant, name: label, status: st.status, pmId: st.pmId, previousPmId: st.previousPmId };
    const events = plan("projects", "update", tenant, row, prev, actorId);
    return { ok: true, message: describe(events, `${label} updated`), events };
  }

  const tenant = activeTenant;
  const st = state(tenant);

  if (collection === "people") {
    if (op === "insert") {
      const name = (values.name ?? "").trim();
      if (!name) return { ok: false, error: "Name is required.", message: "", events: [] };
      // Email: use the provided one if given (must be a safe plus-address), else
      // auto-generate a safe one from the name.
      const em = resolveSafeEmail(values.email, name);
      if (!em.ok) return { ok: false, error: em.error, message: "", events: [] };
      const p: PersonRow = { id: newId("u"), name, role: (values.role as PersonRole) || "Team Member", email: em.email };
      st.people.push(p);
      // Adding someone AS the PM is a reassignment → fires Project Assigned + demotes
      // the previous PM. (A project has one PM.)
      if (p.role === "Project Manager" && st.pmId !== p.id) {
        const r = becomePm(st, tenant, p.id, actorId);
        return { ok: true, message: describe(r.events, `Added ${name} as project manager`), events: r.events, roleSync: r.roleSync, person: { ...p, op: "insert" } };
      }
      return { ok: true, message: `Added ${name} to ${getTenant(tenant).label}.`, events: [], person: { ...p, op: "insert" } };
    }
    if (op === "update") {
      const p = id ? personOf(st, id) : undefined;
      if (!p) return { ok: false, error: "Unknown person.", message: "", events: [] };
      if (values.name !== undefined) p.name = values.name.trim() || p.name;
      if (values.email !== undefined && values.email.trim()) {
        const em = resolveSafeEmail(values.email, p.name);
        if (!em.ok) return { ok: false, error: em.error, message: "", events: [] };
        p.email = em.email;
      }
      // Setting a person's role to Project Manager = reassign the PM to them
      // (fires Project Assigned, demotes the old PM). Other role changes just relabel.
      if (values.role === "Project Manager" && st.pmId !== p.id) {
        const r = becomePm(st, tenant, p.id, actorId);
        return { ok: true, message: describe(r.events, `${p.name} is now the project manager`), events: r.events, roleSync: r.roleSync, person: { ...p, op: "update" } };
      }
      if (values.role && PERSON_ROLES.includes(values.role as PersonRole)) p.role = values.role as PersonRole;
      return { ok: true, message: `${p.name} updated.`, events: [], person: { ...p, op: "update" } };
    }
    if (op === "delete") {
      const p = personOf(st, id ?? "");
      st.people = st.people.filter((x) => x.id !== id);
      return { ok: true, message: "Person removed.", events: [], person: p ? { ...p, op: "delete" } : undefined };
    }
  }

  if (collection === "tasks") {
    if (op === "insert") {
      const name = (values.name ?? "").trim();
      if (!name) return { ok: false, error: "Task name is required.", message: "", events: [] };
      const t: TaskRow = {
        id: newId("task"), name,
        assigneeId: values.assigneeId || st.people[0]?.id || "",
        dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : inDays(9),
        status: (values.status as TaskStatus) || "To do",
      };
      st.tasks.unshift(t);
      const row: Row = { id: t.id, name: t.name, assigneeId: t.assigneeId, dueDate: t.dueDate, status: t.status };
      const events = plan("tasks", "insert", tenant, row, undefined, actorId);
      return { ok: true, message: describe(events, `Task "${name}" added`), events };
    }
    if (op === "update") {
      const t = st.tasks.find((x) => x.id === id);
      if (!t) return { ok: false, error: "Unknown task.", message: "", events: [] };
      const prev: Row = { id: t.id, name: t.name, assigneeId: t.assigneeId, dueDate: t.dueDate, status: t.status };
      if (values.name !== undefined) t.name = values.name.trim() || t.name;
      if (values.assigneeId && personOf(st, values.assigneeId)) t.assigneeId = values.assigneeId;
      if (values.dueDate) t.dueDate = new Date(values.dueDate).toISOString();
      if (values.status && TASK_STATUSES.includes(values.status as TaskStatus)) t.status = values.status as TaskStatus;
      const row: Row = { id: t.id, name: t.name, assigneeId: t.assigneeId, dueDate: t.dueDate, status: t.status };
      const events = plan("tasks", "update", tenant, row, prev, actorId);
      return { ok: true, message: describe(events, `Task "${t.name}" updated`), events };
    }
    if (op === "delete") {
      st.tasks = st.tasks.filter((x) => x.id !== id);
      return { ok: true, message: "Task removed.", events: [] };
    }
  }

  if (collection === "comments") {
    if (op === "insert") {
      const body = (values.body ?? "").trim();
      if (!body) return { ok: false, error: "Comment is required.", message: "", events: [] };
      const c: CommentRow = {
        id: newId("cmt"),
        authorId: values.authorId || st.people[0]?.id || "",
        body, mentionId: values.mentionId || "",
        createdAt: new Date().toISOString(),
      };
      st.comments.unshift(c);
      const row: Row = { id: c.id, authorId: c.authorId, body: c.body, mentionId: c.mentionId };
      const events = plan("comments", "insert", tenant, row, undefined, actorId);
      return { ok: true, message: describe(events, "Comment added"), events };
    }
    if (op === "delete") {
      st.comments = st.comments.filter((x) => x.id !== id);
      return { ok: true, message: "Comment removed.", events: [] };
    }
    return { ok: false, error: "Comments can't be edited.", message: "", events: [] };
  }

  return { ok: false, error: "Unknown collection.", message: "", events: [] };
}

function describe(events: FiredEvent[], base: string): string {
  // Exclude internal signal events (e.g. TASK_CLOSED) — they're not notifications.
  // Object events have no resolved sends (SuprSend fans them out), so summarize by
  // the roles SuprSend will deliver to; individual events list the person count.
  const fired = events.filter((e) => !INTERNAL_EVENTS.has(e.event) && (e.mode === "object" || e.sends.length > 0));
  if (fired.length === 0) return `${base} — no notification (nothing changed or no recipients).`;
  const parts = fired.map((e) =>
    e.mode === "object"
      ? `${e.event} → all project subscribers`
      : `${e.event} · ${e.sends.length} notified`,
  );
  return `${base} — ${parts.join(" + ")}.`;
}
