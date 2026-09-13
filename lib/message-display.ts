// Client-safe display helpers for message data (status + channel labels/icons).
// Pure functions over the serialized MessageRecord — type-only import, no server
// runtime is pulled into the client bundle.
import { Mail, Bell, MessageSquare, MessageCircle, Smartphone } from "lucide-react";
import type { ComponentType } from "react";
import { SlackIcon } from "@/components/icons/slack-icon";
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
// inherit text color); Slack is the official multicolor mark (ignores text color by
// design). The widened type covers both — consumers pass className only.
export const CHANNEL_ICON: Record<string, ComponentType<{ className?: string }>> = {
  email: Mail,
  inbox: Bell,
  sms: MessageSquare,
  androidpush: Smartphone,
  iospush: Smartphone,
  whatsapp: MessageCircle,
  slack: SlackIcon,
};

export const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  inbox: "Inbox",
  sms: "SMS",
  androidpush: "Android Push",
  iospush: "iOS Push",
  whatsapp: "WhatsApp",
  slack: "Slack",
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
