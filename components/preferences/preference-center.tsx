"use client";

import * as React from "react";
import { toast } from "sonner";
import { Bell, type LucideIcon } from "lucide-react";
import type { UserCategory, UserCategoryChannel } from "@/lib/server/subscriber-prefs";
import { EmptyState } from "@/components/shared/empty-state";
import { useResource } from "@/lib/use-resource";
import { PREF_CHANNELS, groupBySection } from "@/lib/preferences";
import { useCollapsibleSections, SectionHeaderRow, HeaderTip } from "@/components/preferences/section-table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { CHANNEL_ICON, CHANNEL_LABEL } from "@/lib/message-display";
import { DigestFrequency, DigestPill, type DigestChoice, type DigestOption, resolveDigestChoice, digestSummary } from "@/components/preferences/digest-frequency";
import { cn } from "@/lib/utils";

// Shared notification preference center for ONE subscriber. Used by both
// User · Preferences (acting as the "viewing as" employee) and Admin · Per-user
// (acting on a picked employee). Reads/writes through a SYNCHRONOUS server route
// (`endpoint`) that PATCHes hub directly — no client-SDK debounce, so a toggle
// persists even if the user immediately navigates away (the bug BTS never had).
// Inbox is now a real, controllable channel: SuprSend returns it from the category
// API (inbox:opt_in/opt_out) and honours it in opt_out_channels, so the Inbox
// toggle reads and writes live like Email/Slack (the SuprSend team fixed the
// earlier "inbox always-on / not returned" limitation).

export function PreferenceCenter({
  distinctId,
  endpoint,
  scope,
  tenantId,
  emptyIcon = Bell,
  emptyTitle,
  emptyDescription,
}: {
  distinctId: string;
  endpoint: string;
  /** "global" = profile baseline (default tenant); else the active project. */
  scope?: "global" | "project";
  /** The project tenant to save under (from the URL). Passed explicitly so the
   *  save can't fall back to the ambient cookie / default tenant. */
  tenantId?: string;
  emptyIcon?: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const scopeQ = scope ? `&scope=${scope}` : "";
  const tenantQ = tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : "";
  const { data: categories, error, reload, setData: setCategories } = useResource(
    `${endpoint}?distinct_id=${encodeURIComponent(distinctId)}${scopeQ}${tenantQ}`,
    (d) => d.categories as UserCategory[],
    "Couldn’t load preferences.",
  );
  // category slug → the allowed cadence set + this user's pick (from the digest API).
  const [digestMap, setDigestMap] = React.useState<Record<string, { schedule: DigestOption[]; choice: DigestChoice }>>({});
  // Collapsible category sections.
  const { isCollapsed, toggle: toggleSection } = useCollapsibleSections();

  // Load the user's digest (allowed cadences + their pick) per category from the
  // preference endpoint (project-scoped). Skips the admin sentinel.
  React.useEffect(() => {
    if (!distinctId || distinctId === "admin") return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/user-digest?distinct_id=${encodeURIComponent(distinctId)}${tenantQ}`, { cache: "no-store" });
        const data = await res.json();
        if (!active || !data.ok) return;
        const map: Record<string, { schedule: DigestOption[]; choice: DigestChoice }> = {};
        for (const e of data.extras as { category: string; digestSchedule: DigestOption[]; digestChoice: DigestChoice }[]) {
          map[e.category] = { schedule: e.digestSchedule, choice: e.digestChoice };
        }
        setDigestMap(map);
      } catch {
        /* non-blocking — digest falls back to the default schedule */
      }
    })();
    return () => {
      active = false;
    };
  }, [distinctId, tenantId]);

  // Save the user's digest pick (or inherit). The preference rides along — the user
  // endpoint requires it on every PATCH.
  async function saveDigest(category: string, choice: DigestChoice) {
    const entry = digestMap[category];
    setDigestMap((m) => ({ ...m, [category]: { schedule: entry?.schedule ?? [], choice } }));
    const cat = categories?.find((c) => c.category === category);
    const preference = cat?.preference === "opt_out" ? "opt_out" : "opt_in";
    const option = resolveDigestChoice(entry?.schedule ?? [], choice);
    try {
      const res = await fetch("/api/user-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distinct_id: distinctId, tenant: tenantId, digest: { category, option, preference } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) toast.error("Couldn’t save digest", { description: data.error });
    } catch {
      toast.error("Couldn’t save digest");
    }
  }

  // Synchronous, awaited write — fires immediately on toggle (no debounce). The
  // optimistic local state is reverted only if the server rejects it.
  async function persist(category: string, preference: "opt_in" | "opt_out", outChannels: string[]) {
    // Never write for a non-subscriber actor (empty or the admin sentinel) — that
    // would 4xx and surface a spurious "couldn't save" toast.
    if (!distinctId || distinctId === "admin") return;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distinct_id: distinctId, category, preference, opt_out_channels: outChannels, scope, tenant: tenantId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        toast.error("Couldn’t save preference", { description: data.error });
        void reload();
      }
    } catch {
      toast.error("Couldn’t save preference");
      void reload();
    }
  }

  function toggleCategory(cat: UserCategory) {
    if (cat.is_editable === false || cat.preference === "cant_unsubscribe") return;
    const next: "opt_in" | "opt_out" = cat.preference === "opt_in" ? "opt_out" : "opt_in";
    setCategories((prev) => prev?.map((c) => (c.category === cat.category ? { ...c, preference: next } : c)) ?? prev);
    const out = (cat.channels ?? []).filter((c) => c.preference === "opt_out").map((c) => c.channel);
    void persist(cat.category, next, out);
  }

  function toggleChannel(cat: UserCategory, ch: UserCategoryChannel) {
    const next: "opt_in" | "opt_out" = ch.preference === "opt_in" ? "opt_out" : "opt_in";
    const base = cat.channels ?? [];
    // The channel may not be in the API's returned set yet (e.g. inbox on the project
    // scope) — append it so the toggle still persists via opt_out_channels.
    const updated: UserCategoryChannel[] = base.some((c) => c.channel === ch.channel)
      ? base.map((c) => (c.channel === ch.channel ? { ...c, preference: next } : c))
      : [...base, { channel: ch.channel, preference: next, is_editable: true }];
    setCategories((prev) => prev?.map((c) => (c.category === cat.category ? { ...c, channels: updated } : c)) ?? prev);
    // Inbox rides on opt_out_channels just like email/slack — SuprSend now honours it.
    const out = updated.filter((c) => c.preference === "opt_out").map((c) => c.channel);
    const catPref: "opt_in" | "opt_out" = cat.preference === "cant_unsubscribe" ? "opt_in" : cat.preference;
    void persist(cat.category, catPref, out);
  }

  if (error) {
    return <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>;
  }
  if (categories === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }

  // Group categories under their parent section (main category → sub-categories).
  const groups = groupBySection(categories, (cat) => cat.section);

  return (
    <div className="max-h-[calc(100vh-13rem)] overflow-auto rounded-lg border border-border bg-card">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[42%]" />
          <col className="w-[13%]" />
          <col className="w-[20%]" />
          <col className="w-[25%]" />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border bg-muted text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Category</th>
            <th className="px-4 py-2 font-medium">
              <HeaderTip label="Preference" tip="Your on/off switch for this notification. Off means you won’t receive it." />
            </th>
            <th className="px-4 py-2 font-medium">
              <HeaderTip label="Frequency" tip="How often you get it — right away, or batched into a digest at a set time." />
            </th>
            <th className="px-4 py-2 font-medium">
              <div className="flex items-center gap-3">
                {PREF_CHANNELS.map((ch) => {
                  const Icon = CHANNEL_ICON[ch];
                  return (
                    <span key={ch} className="flex w-10 justify-center" title={CHANNEL_LABEL[ch] ?? ch} aria-label={CHANNEL_LABEL[ch] ?? ch}>
                      {Icon ? <Icon className="size-4 text-foreground" /> : (CHANNEL_LABEL[ch] ?? ch)}
                    </span>
                  );
                })}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const collapsed = isCollapsed(group.section);
            return (
              <React.Fragment key={group.section}>
                <SectionHeaderRow
                  label={group.section}
                  colSpan={4}
                  collapsed={collapsed}
                  onToggle={() => toggleSection(group.section)}
                />
                {!collapsed &&
                  group.items.map((cat) => (
                    <CategoryRow
                      key={cat.category}
                      cat={cat}
                      digest={digestMap[cat.category]}
                      onDigestChange={(choice) => saveDigest(cat.category, choice)}
                      onToggleCategory={() => toggleCategory(cat)}
                      onToggleChannel={(ch) => toggleChannel(cat, ch)}
                    />
                  ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CategoryRow({
  cat,
  digest,
  onDigestChange,
  onToggleCategory,
  onToggleChannel,
}: {
  cat: UserCategory;
  digest?: { schedule: DigestOption[]; choice: DigestChoice };
  onDigestChange: (choice: DigestChoice) => void;
  onToggleCategory: () => void;
  onToggleChannel: (ch: UserCategoryChannel) => void;
}) {
  // A mandatory (cant_unsubscribe) category comes back from SuprSend as
  // preference:"opt_in" + is_editable:false — the lock is is_editable, NOT the
  // preference string. Treat either signal as locked.
  const locked = cat.is_editable === false || cat.preference === "cant_unsubscribe";
  const categoryOn = cat.preference !== "opt_out";
  // Always render the full channel set (email/inbox/slack) so each has a toggle —
  // even where the subscriber API doesn't yet return one (inbox on the project
  // scope). Missing channels default to on+editable; the API wiring lands later.
  const channels: UserCategoryChannel[] = PREF_CHANNELS.map((key) => {
    const fromApi = (cat.channels ?? []).find((c) => c.channel === key);
    return fromApi ?? { channel: key, preference: "opt_in", is_editable: true };
  });
  // Digest cadence — the user picks one of the admin-allowed options (live); a time
  // appears only where the admin allows it. Empty = this category has no digest
  // (sent immediately) — don't invent a schedule.
  const schedule = digest?.schedule ?? [];
  const pick = digest?.choice ?? {};
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3 align-top">
        <div className="flex items-center gap-2">
          <span className="font-medium">{cat.name}</span>
        </div>
        {cat.description && <div className="mt-0.5 text-xs text-muted-foreground">{cat.description}</div>}
      </td>
      <td className="px-4 py-3 align-top">
        {locked ? (
          <Badge variant="outline" title="Required — can’t opt out.">Required</Badge>
        ) : (
          <Switch checked={categoryOn} onCheckedChange={onToggleCategory} aria-label={`${cat.name} on or off`} />
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {/* Off → —; digest defined → the "Digest" pill (pick cadence inside);
            otherwise sent immediately. Mirrors the admin/project views. */}
        {!categoryOn ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : schedule.length ? (
          <DigestPill summary={(() => { const r = resolveDigestChoice(schedule, pick); return r ? digestSummary(r) : undefined; })()}>
            <DigestFrequency schedule={schedule} value={pick} onChange={onDigestChange} />
          </DigestPill>
        ) : (
          <span className="text-xs text-muted-foreground">Immediate</span>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {/* Channels render as aligned columns under the email / inbox / slack icon
            headers — matching the project + admin settings tables. Off category or a
            required (locked) channel shows a disabled toggle so the grid stays aligned. */}
        <div className={cn("flex items-center gap-3", !categoryOn && "opacity-50")}>
          {channels.map((ch) => {
            const on = ch.preference !== "opt_out";
            const editable = ch.is_editable !== false;
            const label = CHANNEL_LABEL[ch.channel] ?? ch.channel;
            return (
              <span
                key={ch.channel}
                className="flex w-10 justify-center"
                title={editable ? label : `${label} — required, can’t change`}
              >
                <Switch
                  size="sm"
                  checked={categoryOn && on}
                  disabled={!categoryOn || !editable}
                  onCheckedChange={() => onToggleChannel(ch)}
                  aria-label={`${label} for ${cat.name}`}
                />
              </span>
            );
          })}
        </div>
      </td>
    </tr>
  );
}
