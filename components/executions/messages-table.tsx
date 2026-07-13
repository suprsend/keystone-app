"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import type { MessageRecord } from "@/lib/server/messages";
import { Badge } from "@/components/ui/badge";
import { useAppState } from "@/components/providers";
import {
  activityBadge,
  CHANNEL_ICON,
  CHANNEL_LABEL,
  humanizeNode,
  fmtLocal,
  fmtDuration,
} from "@/lib/message-display";

// Row-level status, matching the Wellspring sample: delivered → Success (green),
// a failed send → Failed (red), otherwise still in flight.
function statusBadge(m: MessageRecord): { label: string; tone: "outline" | "destructive"; className?: string } {
  if (m.failed) return { label: "Failed", tone: "destructive" };
  if (m.deliveredAt) return { label: "Success", tone: "outline", className: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" };
  return { label: "In progress", tone: "outline" };
}

const READ_OPTIONS = ["All", "Read", "Unread"] as const;

export function MessagesTable({
  messages,
}: {
  messages: MessageRecord[];
}) {
  const { users } = useAppState();
  const [channel, setChannel] = React.useState("All");
  const [activity, setActivity] = React.useState("All");
  const [template, setTemplate] = React.useState("All");
  const [recipient, setRecipient] = React.useState("All");
  const [read, setRead] = React.useState<(typeof READ_OPTIONS)[number]>("All");
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const nameOf = React.useCallback(
    (id: string) => users.find((u) => u.distinctId === id)?.name ?? id,
    [users],
  );

  // Filter options derived from the data — never show a filter with no matches.
  const channels = React.useMemo(
    () => ["All", ...[...new Set(messages.map((m) => m.channel))].filter(Boolean).sort()],
    [messages],
  );
  // Recipient options: distinct recipient ids present, labelled by name.
  const recipientOptions = React.useMemo(() => {
    const ids = [...new Set(messages.map((m) => m.recipientId).filter(Boolean))];
    // Only current people (resolvable to a name) — skip historical/deleted raw ids.
    const named = ids.map((id) => ({ value: id, label: nameOf(id) })).filter((o) => o.label !== o.value);
    return [{ value: "All", label: "All" }, ...named.sort((a, b) => a.label.localeCompare(b.label))];
  }, [messages, nameOf]);
  const activities = React.useMemo(
    () => ["All", ...[...new Set(messages.map((m) => activityBadge(m).label))].sort()],
    [messages],
  );
  const templates = React.useMemo(
    () => ["All", ...[...new Set(messages.map((m) => m.templateName).filter(Boolean))].sort() as string[]],
    [messages],
  );

  const rows = React.useMemo(
    () =>
      messages.filter((m) => {
        if (channel !== "All" && m.channel !== channel) return false;
        if (recipient !== "All" && m.recipientId !== recipient) return false;
        if (activity !== "All" && activityBadge(m).label !== activity) return false;
        if (template !== "All" && m.templateName !== template) return false;
        if (read !== "All") {
          if (m.channel !== "inbox") return false;
          if (read === "Read" ? !m.isRead : m.isRead) return false;
        }
        return true;
      }),
    [messages, channel, recipient, activity, template, read],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
        <Filter label="Channel" value={channel} onChange={setChannel} options={channels} />
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Recipient</span>
          <select
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-ring focus:outline-none"
          >
            {recipientOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <Filter label="Activity" value={activity} onChange={setActivity} options={activities} />
        <Filter label="Template" value={template} onChange={setTemplate} options={templates} />
        <Filter label="Read" value={read} onChange={(v) => setRead(v as (typeof READ_OPTIONS)[number])} options={[...READ_OPTIONS]} hint="inbox only" />
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} of {messages.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Notification</span>
          <span className="w-24 text-right">Recipient</span>
          <span className="w-20 text-right">Channel</span>
          <span className="w-24 text-right">Status</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No messages match these filters.</div>
        ) : (
          rows.map((m) => (
            <Row
              key={m.messageId}
              m={m}
              open={expanded === m.messageId}
              onToggle={() => setExpanded(expanded === m.messageId ? null : m.messageId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Row({
  m,
  open,
  onToggle,
}: {
  m: MessageRecord;
  open: boolean;
  onToggle: () => void;
}) {
  const { users } = useAppState();
  const Icon = CHANNEL_ICON[m.channel];
  const status = statusBadge(m);
  const recipient = users.find((u) => u.distinctId === m.recipientId)?.name ?? m.recipientId;

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3 text-left hover:bg-muted/20"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="truncate text-sm font-medium text-[var(--brand-blue)]">{m.templateName ?? humanizeNode(m.nodeRef)}</span>
        </span>
        <span className="w-24 truncate text-right text-xs text-muted-foreground">{recipient}</span>
        <span className="flex w-20 items-center justify-end gap-1.5 text-xs text-muted-foreground">
          {Icon && <Icon className="size-3.5 shrink-0" />}
          {CHANNEL_LABEL[m.channel] ?? m.channel}
        </span>
        <span className="w-24 text-right">
          <Badge variant={status.tone} className={status.className}>{status.label}</Badge>
        </span>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/10 px-4 py-4">
          <EventTimeline m={m} />
        </div>
      )}
    </div>
  );
}

// Triggered → Delivered → Seen → Clicked, with elapsed time between stages.
// Read is intentionally absent: it's a mutable flag, shown in the detail grid.
function EventTimeline({ m }: { m: MessageRecord }) {
  const steps: { label: string; iso: string | null; done: boolean; fail?: boolean }[] = m.failed
    ? [
        { label: "Triggered", iso: m.triggeredAt ?? m.createdAt, done: true },
        { label: "Failed", iso: m.deliveredAt ?? m.triggeredAt, done: true, fail: true },
      ]
    : [
        { label: "Triggered", iso: m.triggeredAt ?? m.createdAt, done: true },
        { label: "Delivered", iso: m.deliveredAt, done: Boolean(m.deliveredAt) },
        { label: m.channel === "email" ? "Opened" : "Seen", iso: m.seenAt, done: Boolean(m.seenAt) },
        { label: "Clicked", iso: m.clickedAt, done: Boolean(m.clickedAt) },
      ];

  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Event timeline</div>
      <div className="flex flex-wrap items-start gap-1">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1] : null;
          const dur = prev?.iso && s.iso ? fmtDuration(prev.iso, s.iso) : "";
          return (
            <div key={s.label} className="flex items-start">
              {i > 0 && (
                <div className="flex flex-col items-center px-2 pt-1.5">
                  <div className="h-px w-8 bg-border" />
                  {dur && <span className="mt-0.5 text-[10px] text-muted-foreground">{dur}</span>}
                </div>
              )}
              <div className="flex flex-col">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <span
                    className={`size-2 rounded-full ${
                      s.fail ? "bg-destructive" : s.done ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  />
                  <span className={s.fail ? "text-destructive" : s.done ? "" : "text-muted-foreground"}>{s.label}</span>
                </span>
                <span className="ml-3.5 mt-0.5 text-[11px] text-muted-foreground">{s.iso ? fmtLocal(s.iso) : "—"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-ring focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {hint && value !== "All" && <span className="text-[10px] italic text-muted-foreground">{hint}</span>}
    </label>
  );
}
