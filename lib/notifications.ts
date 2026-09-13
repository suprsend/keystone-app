// The notification model for Keystone (the Keystone PRD). Each notification is
// an organization-level email notification with a trigger, recipient types, and
// content. Customers (workspaces) get the system defaults and can add their own.
//
// Subscriptions resolve by precedence (PRD): a user's project-level choice beats a
// PM-set project choice, which beats the user's global profile choice, which beats
// the organization default (role-based). Nothing is locked in this release.
//
// The data here is the app's static notification catalog (this PRD model), not
// runtime data pulled from SuprSend. With keys, each notification maps to a SuprSend
// workflow + preference category, and subscriptions to per-user (and per-tenant)
// preferences.

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

// ── The eight system notification defaults ───────────────────────────────────
const DEFAULTS: NotificationDef[] = [
  // NOTE: the live template renders per-recipient copy keyed on the reader's
  // per-project role — see suprsend/templates/. The body below is just the
  // static catalog preview.
  {
    id: "project-assigned",
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
 * "Tagged on a Project" → "tagged-on-a-project"). Must match the category slugs in
 * suprsend/preference_categories/categories.json.
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

/** Recipient roles a notification can target. */
export const ROLE_OPTIONS: PersonRole[] = [
  "Project Manager",
  "Team Member",
  "Project Sponsor",
  "Process Owner",
];
