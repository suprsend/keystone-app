// Mock fixtures for preview WITHOUT SuprSend keys. Every server data-read module
// branches here when `!hasWorkspaceKeys(ws)`, so nothing 500s before a customer's
// keys are wired. The roster (lib/people.ts) is the single source of truth for
// users + message recipients, so the mock stays consistent across surfaces.
//
// Fixed ISO timestamps (never Date.now()) keep the output stable across renders.
import { getRoster, type Person } from "@/lib/people";
import { getTenant } from "@/lib/tenants";
import { getNotifications, type NotificationDef } from "@/lib/notifications";
import type { TenantId } from "@/lib/tenants";
import type { WorkspaceSlug } from "@/lib/workspaces";
import type { WorkUser, UserSubscriptions } from "@/lib/server/users";
import type { MessageRecord } from "@/lib/server/messages";
import type { Brand } from "@/lib/server/brand";
import type { PrefCategory, Pref } from "@/lib/server/preference-config";
import type { UserCategory } from "@/lib/server/subscriber-prefs";
import type { OptOutSummary, OptOutRow } from "@/lib/server/opt-outs";
import type { TemplateSummary, WorkflowSummary } from "@/lib/suprsend-mgmt";

// A few fixed reference dates so timestamps look recent but never drift.
const DAY = 86_400_000;
const BASE = Date.parse("2026-06-18T15:00:00.000Z");
const iso = (offsetDays: number, offsetMs = 0): string =>
  new Date(BASE - offsetDays * DAY + offsetMs).toISOString();

// ─────────────────────────── Users ───────────────────────────

/** Map a project roster to the live-user (subscriber) shape. */
export function mockUsers(tenant: TenantId): WorkUser[] {
  return getRoster(tenant).map((p, i) => ({
    distinctId: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    hasInbox: true,
    hasSlack: false,
    // Stable, plausible "joined" dates, newest first (PM added first → oldest).
    createdAt: iso(40 - i * 5),
  }));
}

export function mockUser(tenant: TenantId, distinctId: string): WorkUser | null {
  return mockUsers(tenant).find((u) => u.distinctId === distinctId) ?? null;
}

export function mockUserSubscriptions(): UserSubscriptions {
  return {
    teams: [{ id: "project-team", type: "team", name: "Project Team" }],
    lists: [{ id: "all-employees", name: "All Employees" }],
  };
}

// ─────────────────────────── Messages ───────────────────────────

type ChannelMix = "email" | "inbox";
type Outcome = "delivered" | "seen" | "failed";

interface Seed {
  notif: string; // notification name from getNotifications()
  channel: ChannelMix;
  outcome: Outcome;
  recipient: number; // roster index
  daysAgo: number;
}

// ~15 plausible rows referencing the default notification names + roster recipients.
const SEEDS: Seed[] = [
  { notif: "Project Started", channel: "email", outcome: "seen", recipient: 0, daysAgo: 1 },
  { notif: "Project Started", channel: "inbox", outcome: "seen", recipient: 3, daysAgo: 1 },
  { notif: "Project Started", channel: "email", outcome: "delivered", recipient: 4, daysAgo: 1 },
  { notif: "Task Completed", channel: "email", outcome: "seen", recipient: 0, daysAgo: 2 },
  { notif: "Task Completed", channel: "inbox", outcome: "delivered", recipient: 0, daysAgo: 2 },
  { notif: "Tasks Coming Up", channel: "email", outcome: "seen", recipient: 5, daysAgo: 3 },
  { notif: "Tasks Coming Up", channel: "inbox", outcome: "delivered", recipient: 4, daysAgo: 3 },
  { notif: "Comment Added", channel: "inbox", outcome: "seen", recipient: 3, daysAgo: 4 },
  { notif: "Comment Added", channel: "email", outcome: "failed", recipient: 5, daysAgo: 4 },
  { notif: "Tagged on a Project", channel: "email", outcome: "seen", recipient: 1, daysAgo: 5 },
  { notif: "Tagged on a Project", channel: "inbox", outcome: "delivered", recipient: 2, daysAgo: 5 },
  { notif: "Project Assigned", channel: "email", outcome: "seen", recipient: 0, daysAgo: 7 },
  { notif: "Project Paused", channel: "email", outcome: "delivered", recipient: 3, daysAgo: 9 },
  { notif: "Project Paused", channel: "inbox", outcome: "seen", recipient: 4, daysAgo: 9 },
  { notif: "Task Completed", channel: "email", outcome: "failed", recipient: 0, daysAgo: 11 },
];

const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function mockMessages(ws: WorkspaceSlug, tenant: TenantId): MessageRecord[] {
  const roster = getRoster(tenant);
  const notifs = getNotifications(ws);
  const byName = new Map(notifs.map((n) => [n.name, n]));

  return SEEDS.map((s, i) => {
    const person: Person | undefined = roster[s.recipient % roster.length];
    const notif: NotificationDef | undefined = byName.get(s.notif);
    const wfSlug = slugify(s.notif);
    const created = iso(s.daysAgo);
    const triggered = iso(s.daysAgo);
    const delivered = s.outcome === "failed" ? null : iso(s.daysAgo, 4_000);
    const seen = s.outcome === "seen" ? iso(s.daysAgo, 90_000) : null;
    const failed = s.outcome === "failed";
    const status = failed ? "failed" : seen ? (s.channel === "email" ? "opened" : "seen") : "delivered";
    return {
      messageId: `msg_mock_${tenant}_${i}`,
      createdAt: created,
      updatedAt: seen ?? delivered ?? triggered,
      triggeredAt: triggered,
      deliveredAt: delivered,
      seenAt: seen,
      clickedAt: null,
      readAt: s.channel === "inbox" ? seen : null,
      unreadAt: null,
      isRead: s.channel === "inbox" && Boolean(seen),
      status,
      channel: s.channel,
      idempotencyKey: `run_mock_${tenant}_${i}`,
      executionId: `exec_mock_${tenant}_${i}`,
      nodeRef: null,
      recipientId: person?.id ?? "unknown",
      recipientEmail: person?.email ?? null,
      workflowSlug: wfSlug,
      workflowName: s.notif,
      templateName: `${s.notif} ${s.channel === "email" ? "Email" : "Inbox"}`,
      templateVersion: 1,
      vendorName: s.channel === "email" ? "Amazon SES" : null,
      vendorNickname: s.channel === "email" ? "ses" : null,
      tenantId: tenant,
      category: notif?.group ?? null,
      failureReason: failed ? "Bounced — mailbox unavailable" : "",
      failed,
    };
  });
}

// ─────────────────────────── Brand ───────────────────────────

/** The active project's accent + name as the brand (live source: SuprSend). */
export function mockBrand(tenant: TenantId): Brand {
  const t = getTenant(tenant);
  return {
    tenantName: t.fullName,
    logo: "",
    primaryColor: t.accent,
    secondaryColor: "#1f2937",
    tertiaryColor: "#6b7280",
    socialLinks: { website: "", linkedin: "", twitter: "", facebook: "", instagram: "" },
    properties: {},
  };
}

// ─────────────────────── Preference config ───────────────────────

// Map a notification group → a preference root (system vs transactional).
const GROUP_ROOT: Record<NotificationDef["group"], "transactional" | "system"> = {
  Assignments: "transactional",
  "Project status": "transactional",
  Tasks: "transactional",
  Collaboration: "system",
};

/** One preference category per default notification, grouped by its section. */
export function mockPreferenceConfig(ws: WorkspaceSlug): PrefCategory[] {
  return getNotifications(ws)
    .filter((n) => n.isDefault)
    .map((n) => ({
      root: GROUP_ROOT[n.group],
      section: n.group,
      category: n.id,
      name: n.name,
      description: n.description,
      preference: "opt_in" as Pref,
      optInChannels: ["email", "inbox"],
      mandatoryChannels: [],
      digestEnabled: false,
      digest: [],
      conditions: [],
    }));
}

// ─────────────────── Per-user (subscriber) prefs ───────────────────

/** A user's category prefs — defaults to opted-in, mirroring the org defaults. */
export function mockUserCategories(ws: WorkspaceSlug): UserCategory[] {
  return getNotifications(ws)
    .filter((n) => n.isDefault)
    .map((n) => ({
      category: n.id,
      name: n.name,
      description: n.description,
      preference: "opt_in" as const,
      original_preference: null,
      is_editable: true,
      channels: [
        { channel: "email", preference: "opt_in" as const, is_editable: true },
        { channel: "inbox", preference: "opt_in" as const, is_editable: true },
      ],
      section: n.group,
    }));
}

// ─────────────────────────── Opt-outs ───────────────────────────

/** A light opt-out summary so the card renders with non-zero, plausible numbers. */
export function mockOptOutSummary(ws: WorkspaceSlug, tenant: TenantId): OptOutSummary {
  const users = getRoster(tenant);
  const config = mockPreferenceConfig(ws);
  const rows = config.map((c, i) => {
    const channelOptOuts: OptOutRow["channelOptOuts"] = {};
    if (i === 2) channelOptOuts.inbox = { muted: 1, byDefault: 0 };
    return {
      category: c.category,
      name: c.name,
      userOptOut: i === 1 ? 1 : 0,
      defaultOptOut: 0,
      channelOptOuts,
    };
  });
  return {
    totalUsers: users.length,
    usersOptedOut: 2,
    usersDefaultOff: 0,
    rows,
  };
}

// ─────────────────────────── Templates ───────────────────────────

export function mockTemplates(): TemplateSummary[] {
  return [
    {
      slug: "project-started-email",
      name: "Project Started Email",
      description: "Sent to the project team when a project goes in-flight.",
      enabled_channels: ["email", "inbox"],
      status: "active",
      version_no: 2,
      updated_at: iso(3),
      last_triggered_at: iso(1),
      channels: [
        { channel: "email", is_active: true, variants_count: 1 },
        { channel: "inbox", is_active: true, variants_count: 1 },
      ],
    },
    {
      slug: "task-completed-email",
      name: "Task Completed Email",
      description: "Notifies the project manager when a task is marked complete.",
      enabled_channels: ["email"],
      status: "active",
      version_no: 1,
      updated_at: iso(6),
      last_triggered_at: iso(2),
      channels: [{ channel: "email", is_active: true, variants_count: 1 }],
    },
    {
      slug: "gate-review-reminder",
      name: "Gate Review Reminder",
      description: "Reminds the team three days before a scheduled gate review.",
      enabled_channels: ["email", "inbox"],
      status: "draft",
      version_no: null,
      updated_at: iso(10),
      last_triggered_at: null,
      channels: [
        { channel: "email", is_active: true, variants_count: 1 },
        { channel: "inbox", is_active: true, variants_count: 1 },
      ],
    },
  ];
}

export function mockTemplate(slug: string): TemplateSummary | null {
  return mockTemplates().find((t) => t.slug === slug) ?? null;
}

// ─────────────────────────── Workflows ───────────────────────────

export function mockWorkflows(): WorkflowSummary[] {
  return [
    {
      slug: "project-lifecycle",
      name: "Project Lifecycle",
      trigger_type: "api",
      category: "transactional",
      description: "Notifies the team as a project starts, pauses and resumes.",
      status: "active",
      updated_at: iso(4),
      last_executed_at: iso(1),
      updated_by: { name: "Wellspring", email: "" },
      tree: { nodes: [] },
    },
    {
      slug: "task-reminders",
      name: "Task Reminders",
      trigger_type: "api",
      category: "transactional",
      description: "Reminds assignees of tasks due within three days.",
      status: "draft",
      updated_at: iso(8),
      last_executed_at: null,
      updated_by: { name: "Wellspring", email: "" },
      tree: { nodes: [] },
    },
  ];
}

export function mockWorkflow(slug: string): WorkflowSummary | null {
  return mockWorkflows().find((w) => w.slug === slug) ?? null;
}
