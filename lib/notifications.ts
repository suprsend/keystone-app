// The notification model for Keystone (the Keystone PRD). Each notification is
// an organization-level email notification with a trigger, recipient types, and
// content. Customers (workspaces) get the system defaults and can add their own.
//
// Subscriptions resolve by precedence (PRD): a user's project-level choice beats a
// PM-set project choice, which beats the user's global profile choice, which beats
// the organization default (role-based). Nothing is locked in this release.
//
// All data here is mock so the app previews without SuprSend keys. When keys land,
// notifications map to SuprSend workflows + preference categories and subscriptions
// to per-user (and per-tenant) preferences.

import type { PersonRole } from "@/lib/people";
import type { WorkspaceSlug } from "@/lib/workspaces";

export type NotifTriggerKey =
  | "project_assigned"
  | "project_started"
  | "project_paused"
  | "task_completed"
  | "task_upcoming"
  | "comment_added"
  | "tagged_on_project";

export type NotifGroup = "Assignments" | "Project status" | "Tasks" | "Collaboration";

export interface NotificationDef {
  id: string;
  /** Ticket reference from the PRD (shown in detail for traceability). */
  ref: string;
  name: string;
  /** Plain-English "when it fires" — shown to admins and subscribers. */
  description: string;
  group: NotifGroup;
  trigger: NotifTriggerKey;
  triggerLabel: string;
  /** Recipient TYPES (roles). Drives the role-based subscription default. */
  recipients: PersonRole[];
  subject: string;
  body: string;
  active: boolean;
  /** System default (shipped by Keystone) vs custom (created by the customer admin). */
  isDefault: boolean;
}

// ── The seven system defaults from the PRD ───────────────────────────────────
const DEFAULTS: NotificationDef[] = [
  // NOTE: live template renders PER-RECIPIENT copy keyed on `recipient_type`
  // (new_pm / previous_pm / process_owner) — see scripts/provision.mjs. The body
  // below is just the static catalog preview.
  {
    id: "project-assigned",
    ref: "PHX-18688",
    name: "Project Assigned",
    description: "When a project manager is assigned to a project, or replaced by a different manager.",
    group: "Assignments",
    trigger: "project_assigned",
    triggerLabel: "Project manager assigned or changed",
    recipients: ["Project Manager", "Process Owner"],
    subject: "You've been assigned to {{project.name}}",
    body: "Hi {{user.name}},\n\nYou are now the project manager for {{project.name}}. The previous manager has been notified of the change.\n\nOpen the project to review its current stage and gates.",
    active: true,
    isDefault: true,
  },
  {
    id: "project-started",
    ref: "PHX-18696",
    name: "Project Started",
    description: "When a project's status is set to In-flight.",
    group: "Project status",
    trigger: "project_started",
    triggerLabel: "Project status → In-flight",
    recipients: ["Project Manager", "Team Member", "Project Sponsor"],
    subject: "{{project.name}} has started",
    body: "Hi {{user.name}},\n\n{{project.name}} is now in-flight. You're on the team — open the project to see your tasks and the current stage gate.",
    active: true,
    isDefault: true,
  },
  {
    id: "project-paused",
    ref: "PHX-18698",
    name: "Project Paused",
    description: "When a project is paused.",
    group: "Project status",
    trigger: "project_paused",
    triggerLabel: "Project status → Paused",
    recipients: ["Team Member", "Project Sponsor"],
    subject: "{{project.name}} has been paused",
    body: "Hi {{user.name}},\n\n{{project.name}} has been paused. No further tasks are due until it resumes. You'll be notified when work restarts.",
    active: true,
    isDefault: true,
  },
  {
    id: "task-completed",
    ref: "PHX-18692",
    name: "Task Completed",
    description: "When a task on a project is marked complete.",
    group: "Tasks",
    trigger: "task_completed",
    triggerLabel: "Task marked complete",
    recipients: ["Project Manager"],
    subject: "Task completed: {{task.name}}",
    body: "Hi {{user.name}},\n\n{{task.assignee}} marked \"{{task.name}}\" complete on {{project.name}}.",
    active: true,
    isDefault: true,
  },
  {
    id: "task-upcoming",
    ref: "PHX-18702",
    name: "Tasks Coming Up",
    description: "When a task assigned to you is approaching its due date.",
    group: "Tasks",
    trigger: "task_upcoming",
    triggerLabel: "Task due within 3 days",
    recipients: ["Team Member", "Project Manager"],
    subject: "Due soon: {{task.name}}",
    body: "Hi {{user.name}},\n\n\"{{task.name}}\" on {{project.name}} is due {{task.due_date}}. ",
    active: true,
    isDefault: true,
  },
  {
    id: "comment-added",
    ref: "PHX-18701",
    name: "Comment Added",
    description: "When a comment is added to a project you're on.",
    group: "Collaboration",
    trigger: "comment_added",
    triggerLabel: "Comment added to project",
    recipients: ["Project Manager", "Team Member"],
    subject: "New comment on {{project.name}}",
    body: "Hi {{user.name}},\n\n{{comment.author}} commented on {{project.name}}:\n\n\"{{comment.body}}\"",
    active: true,
    isDefault: true,
  },
  {
    id: "tagged-on-project",
    ref: "PHX-18695",
    name: "Tagged on a Project",
    description: "When someone @mentions you on a project.",
    group: "Collaboration",
    trigger: "tagged_on_project",
    triggerLabel: "User @mentioned",
    recipients: ["Project Manager", "Team Member", "Project Sponsor", "Process Owner"],
    subject: "{{actor.name}} tagged you on {{project.name}}",
    body: "Hi {{user.name}},\n\n{{actor.name}} tagged you in a discussion on {{project.name}}. Open the project to reply.",
    active: true,
    isDefault: true,
  },
];

// One custom (admin-created) notification per customer — shows the "custom" +
// "inactive" states in the admin list.
const CUSTOM: Record<WorkspaceSlug, NotificationDef[]> = {
  "acme": [
    {
      id: "weekly-portfolio-digest",
      ref: "Custom",
      name: "Weekly Portfolio Digest",
      description: "Every Monday, a summary of stage-gate movement across the portfolio.",
      group: "Project status",
      trigger: "project_started",
      triggerLabel: "Schedule — weekly (Mon 8am)",
      recipients: ["Project Sponsor", "Process Owner"],
      subject: "Your weekly portfolio digest",
      body: "Hi {{user.name}},\n\nHere's what moved across your projects this week.",
      active: false,
      isDefault: false,
    },
  ],
  "globex": [
    {
      id: "gate-review-reminder",
      ref: "Custom",
      name: "Gate Review Reminder",
      description: "Three days before a scheduled gate review, remind the project team.",
      group: "Tasks",
      trigger: "task_upcoming",
      triggerLabel: "Gate review in 3 days",
      recipients: ["Project Manager", "Team Member"],
      subject: "Gate review approaching for {{project.name}}",
      body: "Hi {{user.name}},\n\nThe next gate review for {{project.name}} is in 3 days. Make sure your deliverables are uploaded.",
      active: false,
      isDefault: false,
    },
  ],
};

/** All notifications configured for a customer (defaults + their custom ones). */
export function getNotifications(ws: WorkspaceSlug): NotificationDef[] {
  return [...DEFAULTS, ...(CUSTOM[ws] ?? [])];
}

/**
 * The SuprSend preference-category slug for a notification name. SuprSend derives
 * category slugs from the NAME (e.g. "Tasks Coming Up" → "tasks-coming-up",
 * "Tagged on a Project" → "tagged-on-a-project"). Must match scripts/provision.mjs.
 */
export function categorySlugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * The live SuprSend WORKFLOW slug for a notification. Equals the notification id
 * except where they intentionally diverge (notif id `task-upcoming` →
 * workflow/event slug `tasks-upcoming`). Used to read/write live workflow config.
 */
export function workflowSlugOf(notifId: string): string {
  return notifId === "task-upcoming" ? "tasks-upcoming" : notifId;
}

/**
 * The live SuprSend TEMPLATE slug for a notification. Equals the notification id
 * except where they diverge: Comment Added is batched, so its template lives at
 * `comment-added-batched` (the workflow's send node points there). Used so a link
 * to /admin/templates/<notif-id> resolves to the real template variant.
 */
export function templateSlugOf(notifId: string): string {
  return notifId === "comment-added" ? "comment-added-batched" : notifId;
}

export function getNotification(ws: WorkspaceSlug, id: string): NotificationDef | undefined {
  return getNotifications(ws).find((n) => n.id === id);
}

export const NOTIF_GROUPS: NotifGroup[] = ["Assignments", "Project status", "Tasks", "Collaboration"];

/** Trigger events an admin can pick from when creating/editing a notification. */
export const TRIGGER_OPTIONS: { key: NotifTriggerKey; label: string; group: NotifGroup }[] = [
  { key: "project_assigned", label: "Project manager assigned or changed", group: "Assignments" },
  { key: "project_started", label: "Project status → In-flight", group: "Project status" },
  { key: "project_paused", label: "Project status → Paused", group: "Project status" },
  { key: "task_completed", label: "Task marked complete", group: "Tasks" },
  { key: "task_upcoming", label: "Task due within 3 days", group: "Tasks" },
  { key: "comment_added", label: "Comment added to project", group: "Collaboration" },
  { key: "tagged_on_project", label: "User @mentioned on project", group: "Collaboration" },
];

/** Recipient roles a notification can target. */
export const ROLE_OPTIONS: PersonRole[] = [
  "Project Manager",
  "Team Member",
  "Project Sponsor",
  "Process Owner",
];

// ── Subscriptions ────────────────────────────────────────────────────────────
export type SubSource = "default" | "profile" | "pm" | "project";

/** The organization default for a person: subscribed if their role is a recipient. */
export function defaultSubscribed(notif: NotificationDef, role: PersonRole): boolean {
  return notif.recipients.includes(role);
}

export interface ResolvedSub {
  subscribed: boolean;
  /** Where the current value came from — drives the "inherited / PM-managed" labels. */
  source: SubSource;
}

/**
 * Resolve a subscription at PROJECT scope using PRD precedence:
 * user's project choice → PM's project choice → user's profile choice → org default.
 */
export function resolveProjectSub(
  notif: NotificationDef,
  role: PersonRole,
  opts: { projectOverride?: boolean; pmOverride?: boolean; profileOverride?: boolean },
): ResolvedSub {
  if (opts.projectOverride !== undefined) return { subscribed: opts.projectOverride, source: "project" };
  if (opts.pmOverride !== undefined) return { subscribed: opts.pmOverride, source: "pm" };
  if (opts.profileOverride !== undefined) return { subscribed: opts.profileOverride, source: "profile" };
  return { subscribed: defaultSubscribed(notif, role), source: "default" };
}

/** Resolve a subscription at PROFILE (global) scope: user's profile choice → org default. */
export function resolveProfileSub(
  notif: NotificationDef,
  role: PersonRole,
  profileOverride?: boolean,
): ResolvedSub {
  if (profileOverride !== undefined) return { subscribed: profileOverride, source: "profile" };
  return { subscribed: defaultSubscribed(notif, role), source: "default" };
}
