// Client-safe display helpers for message data (status + channel labels/icons).
// Pure functions over the serialized MessageRecord — type-only import, no server
// runtime is pulled into the client bundle.
import { Mail, Bell, MessageSquare, MessageCircle, Smartphone } from "lucide-react";
import type { ComponentType } from "react";
import { TeamsIcon } from "@/components/icons/teams-icon";
import type { MessageRecord } from "@/lib/server/messages";

export type BadgeTone = "default" | "secondary" | "destructive" | "outline";

// The furthest stage a message reached, by timestamp presence (not the single
// latest `status` string — a "seen" message was also delivered). Failed is terminal.
export function activityBadge(m: MessageRecord): { label: string; tone: BadgeTone } {
  if (m.failed) return { label: "Failed", tone: "destructive" };
  if (m.readAt) return { label: "Read", tone: "default" };
  if (m.clickedAt) return { label: "Clicked", tone: "default" };
  if (m.seenAt) return { label: m.channel === "email" ? "Opened" : "Seen", tone: "default" };
  if (m.deliveredAt) return { label: "Delivered", tone: "secondary" };
  if (m.triggeredAt) return { label: "Sent", tone: "outline" };
  return { label: "Queued", tone: "outline" };
}

/** The timestamp behind activityBadge — for the "last activity" column / tooltip. */
export function lastActivityIso(m: MessageRecord): string | null {
  return m.readAt ?? m.clickedAt ?? m.seenAt ?? m.deliveredAt ?? m.triggeredAt ?? m.updatedAt ?? m.createdAt ?? null;
}

export type RunStatus = "delivered" | "partial" | "failed" | "in_progress";

export function runStatusBadge(status: RunStatus): { label: string; tone: BadgeTone; className?: string } {
  switch (status) {
    case "delivered":
      return { label: "All delivered", tone: "secondary" };
    case "partial":
      return { label: "Partial failure", tone: "outline", className: "border-amber-300 text-amber-700 dark:text-amber-400" };
    case "failed":
      return { label: "Failed", tone: "destructive" };
    case "in_progress":
      return { label: "In progress", tone: "outline" };
  }
}

// ───────────────────────── Analytics aggregation ─────────────────────────
// Funnel counts by timestamp presence (a "seen" msg was also delivered), not the
// single latest `status`. Same logic the server used — moved client-side so a
// channel filter just re-aggregates the same raw record list.

export interface Funnel {
  sent: number;
  delivered: number;
  opened: number;
  failed: number;
}
export interface Breakdown extends Funnel {
  label: string;
  /** Identifier to match against the live set (workflow slug, or template name). */
  slug?: string;
}
export interface Analytics {
  overall: Funnel;
  byChannel: Breakdown[];
  byTemplate: Breakdown[];
  byWorkflow: Breakdown[];
}

function emptyFunnel(): Funnel {
  return { sent: 0, delivered: 0, opened: 0, failed: 0 };
}
function tally(f: Funnel, m: MessageRecord) {
  f.sent += 1;
  if (m.deliveredAt) f.delivered += 1;
  if (m.seenAt) f.opened += 1;
  if (m.failed) f.failed += 1;
}

/** Aggregate a record list into funnel + per-template + per-workflow breakdowns. */
export function computeAnalytics(records: MessageRecord[]): Analytics {
  const overall = emptyFunnel();
  const channels = new Map<string, Breakdown>();
  const templates = new Map<string, Breakdown>();
  const workflows = new Map<string, Breakdown>();
  const bump = (map: Map<string, Breakdown>, label: string, m: MessageRecord, slug?: string) => {
    const row = map.get(label) ?? { label, slug, ...emptyFunnel() };
    tally(row, m);
    map.set(label, row);
  };
  for (const m of records) {
    tally(overall, m);
    if (m.channel) bump(channels, m.channel, m);
    bump(templates, m.templateName ?? "Untitled template", m, m.templateName ?? undefined);
    if (m.workflowSlug) bump(workflows, m.workflowName ?? m.workflowSlug, m, m.workflowSlug);
  }
  const order = (a: Breakdown, b: Breakdown) => b.sent - a.sent;
  return {
    overall,
    byChannel: [...channels.values()].sort(order),
    byTemplate: [...templates.values()].sort(order),
    byWorkflow: [...workflows.values()].sort(order),
  };
}

// Humanize a workflow node ref generically (no per-workflow hardcoding):
// "send_benefits_reminder" → "Benefits Reminder", "delay_2d" → "Delay 2d".
export function humanizeNode(ref?: string | null): string {
  if (!ref) return "Step";
  return ref
    .replace(/^send_/, "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Icons are rendered as `<Icon className="size-4" />`. Most are lucide (monochrome,
// inherit text color); Teams is the official multicolor mark (ignores text color by
// design). The widened type covers both — consumers pass className only.
// NOTE: the `slack` KEY is kept (templates/workflows/prefs still use it internally),
// but it's branded as Microsoft TEAMS — Keystone uses Teams, not Slack, and there's
// no real Teams channel wired (display-only; the Slack webhook delivery was removed).
export const CHANNEL_ICON: Record<string, ComponentType<{ className?: string }>> = {
  email: Mail,
  inbox: Bell,
  sms: MessageSquare,
  androidpush: Smartphone,
  iospush: Smartphone,
  whatsapp: MessageCircle,
  slack: TeamsIcon,
};

export const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  inbox: "Inbox",
  sms: "SMS",
  androidpush: "Android Push",
  iospush: "iOS Push",
  whatsapp: "WhatsApp",
  slack: "Teams",
};

export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function timeOfDay(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Full local timestamp with seconds — for the detail / timeline rows. */
export function fmtLocal(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Compact elapsed time between two ISO stamps: "45ms", "1.2s", "3m", "2h". */
export function fmtDuration(fromIso?: string | null, toIso?: string | null): string {
  if (!fromIso || !toIso) return "";
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (isNaN(ms) || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${Math.round(h / 24)}d`;
}
