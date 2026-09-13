"use client";

import * as React from "react";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import type { Pref } from "@/lib/server/preference-config";
import type { PersonRole } from "@/lib/people";
import { useAppState } from "@/components/providers";
import { getTenant } from "@/lib/tenants";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { RecipientCell, type Candidate } from "@/components/admin/recipient-cell";
import { ExceptCell, type ExceptPerson } from "@/components/admin/except-cell";
import { ConditionsCell, type Condition } from "@/components/admin/conditions-cell";
import { DigestFrequency, DigestPill, type DigestOption, type DigestChoice, defaultDigestSchedule, resolveDigestChoice, digestSummary } from "@/components/preferences/digest-frequency";
import { CHANNEL_LABEL } from "@/lib/message-display";
import { PREF_CHANNELS, PREF_LABEL, groupBySection } from "@/lib/preferences";
import { useCollapsibleSections, SectionHeaderRow, HeaderTip, ChannelHeaderIcons } from "@/components/preferences/section-table";
import { cn } from "@/lib/utils";

// Project notification settings (per-project). SuprSend resolves preferences in
// the order user → PROJECT default → workspace default. Columns:
//  • Active     — whether this project uses the category at all (off = not sent).
//  • Default    — the per-user starting point (On / Off / Mandatory). Inherited
//    from the workspace by default; change it here to override for this project.
//  • Recipients — which roles receive it (live `recip:` tags on the workflow).
//  • Channel    — which channels this project delivers on.
//  • Conditions — extra gates the workflow evaluates on top of role, e.g. the cost
//    threshold Budget Alert must exceed before it sends.

interface Row {
  category: string;
  name: string;
  section: string;
  description: string | null;
  categoryDefault: Pref;
  preference: Pref | null;
  visibleToSubscriber: boolean;
  channels: string[];
  blockedChannels: string[];
}

interface RecipConfig {
  slug: string;
  category: string;
  roles: PersonRole[];
  /** Dashboard-managed roles the app displays but never edits. */
  extraRoles?: string[];
  emails: string[];
}

// Formal project roles (their own Resources sections). Anyone else subscribed to the
// project is a passive "outsider" (Watcher) — added only as an always-notify recipient.
const FORMAL_ROLES = ["Project Manager", "Process Owner", "Project Sponsor", "Team Member"];

// The full workspace roster (= SuprSend `users.list`, minus the admin sentinel): the
// union of a project's members and the workspace people NOT on it — both returned by
// /api/admin/project-members. This is the picker source so ANY workspace user can be
// added/excluded. We deliberately do NOT use /api/users, which is filtered down to the
// active project's members (~10) and so can never offer the whole workspace.
type MemberRow = { distinctId: string; name: string; email: string | null };
function fullRoster(data: { members?: MemberRow[]; candidates?: Candidate[] }): Candidate[] {
  return [
    ...(data.members ?? []).map((m) => ({ distinctId: m.distinctId, name: m.name, email: m.email ?? null })),
    ...(data.candidates ?? []),
  ];
}

export function TenantDefaultsClient() {
  const { tenant } = useAppState();
  return <Body key={tenant} />;
}

function Body() {
  const { tenant, users, refreshUsers } = useAppState();
  const project = getTenant(tenant);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [original, setOriginal] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // category slug → live recipient config (workflow slug + roles).
  const [recip, setRecip] = React.useState<Record<string, RecipConfig>>({});
  // UI-only (API wired later): per-project digest schedule + conditions that gate
  // each notification. A project's settings override the workspace defaults.
  // The admin-allowed cadence options (from the workspace; read-only here — the
  // project can pick/tweak within them but can't add cadences), plus the project's
  // own pick. Just like the user picker, one level down.
  const [schedule, setSchedule] = React.useState<Record<string, DigestOption[]>>({});
  const [digestChoice, setDigestChoice] = React.useState<Record<string, DigestChoice>>({});
  const [conds, setConds] = React.useState<Record<string, Condition[]>>({});
  // Excluded people per category (distinct_ids) from the `except` condition attribute.
  const [exceptIds, setExceptIds] = React.useState<Record<string, string[]>>({});
  // Always-notify people per category (distinct_ids) from the `include` condition
  // attribute — recipients added in Recipients regardless of role (inverse of except).
  const [includeIds, setIncludeIds] = React.useState<Record<string, string[]>>({});
  // Recipient roles per category, from the native `role` condition attribute.
  const [tenantRoles, setTenantRoles] = React.useState<Record<string, string[]>>({});
  // The full workspace roster (members + everyone else) — the Recipients/Except picker
  // source. See `fullRoster` above for why this isn't /api/users.
  const [roster, setRoster] = React.useState<Candidate[]>([]);
  const loadCandidates = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/project-members?tenant=${encodeURIComponent(tenant)}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) setRoster(fullRoster(data));
    } catch {
      /* non-blocking */
    }
  }, [tenant]);
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/project-members?tenant=${encodeURIComponent(tenant)}`, { cache: "no-store" });
        const data = await res.json();
        if (active && data.ok) setRoster(fullRoster(data));
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      active = false;
    };
  }, [tenant]);

  // Add an existing workspace person to this project (subscribe to the object) with
  // an optional role. Live: writes the object subscription via /api/admin/project-members.
  async function addMember(distinctId: string, role: string) {
    const name = roster.find((c) => c.distinctId === distinctId)?.name ?? "User";
    try {
      const res = await fetch("/api/admin/project-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distinctId, role, tenant }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`${name} added to the project${role ? ` as ${role}` : ""}.`);
        await Promise.all([loadCandidates(), refreshUsers()]);
      } else {
        toast.error("Couldn’t add person", { description: data.error });
      }
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    }
  }

  // Override (or inherit) the project's digest default for a category.
  async function saveTenantDigest(category: string, choice: DigestChoice) {
    setDigestChoice((m) => ({ ...m, [category]: choice }));
    const option = resolveDigestChoice(schedule[category] ?? defaultDigestSchedule(), choice);
    try {
      const res = await fetch("/api/admin/tenant-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest: { category, option } }),
      });
      const data = await res.json();
      if (!data.ok) toast.error("Couldn’t save digest", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    }
  }

  // Clear the project's digest override → inherit the workspace default (option: null).
  async function resetTenantDigest(category: string) {
    setDigestChoice((m) => ({ ...m, [category]: {} }));
    try {
      const res = await fetch("/api/admin/tenant-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest: { category, option: null } }),
      });
      const data = await res.json();
      if (!data.ok) toast.error("Couldn’t reset digest", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    }
  }

  // Override (or clear) the project's condition values (cost) for a category.
  async function saveTenantConditions(category: string, conditions: Condition[]) {
    setConds((m) => ({ ...m, [category]: conditions }));
    try {
      const res = await fetch("/api/admin/tenant-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditions: { category, conditions } }),
      });
      const data = await res.json();
      if (!data.ok) toast.error("Couldn’t save conditions", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    }
  }

  // Override the project's excluded people (the `except` condition attribute).
  async function saveTenantExcept(category: string, people: ExceptPerson[]) {
    const distinctIds = people.map((p) => p.distinctId);
    setExceptIds((m) => ({ ...m, [category]: distinctIds }));
    try {
      const res = await fetch("/api/admin/tenant-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ except: { category, distinctIds } }),
      });
      const data = await res.json();
      if (!data.ok) toast.error("Couldn’t save Except", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    }
  }

  // Override the project's recipient roles (the native `role` condition attribute).
  async function saveTenantRoles(category: string, roles: PersonRole[]) {
    setTenantRoles((m) => ({ ...m, [category]: roles }));
    try {
      const res = await fetch("/api/admin/tenant-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: { category, roles } }),
      });
      const data = await res.json();
      if (!data.ok) toast.error("Couldn’t save recipients", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    }
  }

  // Picker roster = the full workspace user list (SuprSend `users.list`, served by
  // The Recipients (include) + Except pickers both draw from the full workspace roster
  // (`users.list`) — see `roster`/`fullRoster` above. Only these two person-pickers use
  // it; project membership and everything else are untouched.
  const allPeople: Candidate[] = roster;

  // Save the per-category include (always-notify) override.
  async function saveInclude(category: string, distinctIds: string[]) {
    try {
      const res = await fetch("/api/admin/tenant-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ include: { category, distinctIds } }),
      });
      const data = await res.json();
      if (!data.ok) toast.error("Couldn’t save recipient", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    }
  }
  // Add an always-notify recipient to a category. Outsiders are first subscribed to
  // the project object (so object fan-out reaches them); existing members keep their
  // role — we only add them to the category's include list.
  async function addInclude(category: string, distinctId: string, role: string) {
    const isMember = users.some((u) => u.distinctId === distinctId);
    if (!isMember) await addMember(distinctId, role || "Watcher");
    const next = [...new Set([...(includeIds[category] ?? []), distinctId])];
    setIncludeIds((m) => ({ ...m, [category]: next }));
    await saveInclude(category, next);
  }
  async function removeInclude(category: string, distinctId: string) {
    const next = (includeIds[category] ?? []).filter((id) => id !== distinctId);
    const nextMap = { ...includeIds, [category]: next };
    setIncludeIds(nextMap);
    await saveInclude(category, next);

    // "Remove from recipients" should remove the person everywhere. If they were here
    // only as an always-notify outsider (a passive Watcher, not a formal role-holder)
    // and they're no longer on ANY category's include list, unsubscribe them from the
    // project object too — so they disappear from Resources and get no further
    // notifications. Real members (PM / Process Owner / Sponsor / Team Member) are left
    // subscribed; we only drop them from this recipient list.
    const stillIncluded = Object.values(nextMap).some((ids) => ids.includes(distinctId));
    const role = users.find((u) => u.distinctId === distinctId)?.role ?? "";
    if (!stillIncluded && !FORMAL_ROLES.includes(role)) {
      try {
        const res = await fetch(`/api/admin/project-members?distinct_id=${encodeURIComponent(distinctId)}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) await Promise.all([loadCandidates(), refreshUsers()]);
        else toast.error("Couldn’t remove recipient from the project", { description: data.error });
      } catch {
        toast.error("Couldn’t reach SuprSend.");
      }
    }
  }

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/tenant-preferences", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!data.ok) {
          setError(data.error ?? "Couldn’t load project settings.");
          setRows([]);
          return;
        }
        setRows(data.rows);
        setOriginal(JSON.stringify(data.rows));
      } catch {
        if (active) {
          setError("Couldn’t reach SuprSend.");
          setRows([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load the live digest schedule (allowed set + this project's override) and
  // condition values for the project from the preference endpoint.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/tenant-digest?tenant=${encodeURIComponent(tenant)}`, { cache: "no-store" });
        const data = await res.json();
        if (!active || !data.ok) return;
        const sched: Record<string, DigestOption[]> = {};
        const choice: Record<string, DigestChoice> = {};
        const cnd: Record<string, Condition[]> = {};
        const exc: Record<string, string[]> = {};
        const inc: Record<string, string[]> = {};
        const rls: Record<string, string[]> = {};
        for (const e of data.extras as { category: string; digestSchedule: DigestOption[]; digestOverride: DigestOption[]; conditions: Condition[]; except: string[]; include: string[]; roles: string[] }[]) {
          sched[e.category] = e.digestSchedule;
          const ov = e.digestOverride[0];
          choice[e.category] = ov
            ? { selectedId: ov.id, time: ov.time, days: ov.days, ordinal: ov.ordinal, unit: ov.unit }
            : {};
          cnd[e.category] = e.conditions;
          exc[e.category] = e.except ?? [];
          inc[e.category] = e.include ?? [];
          rls[e.category] = e.roles ?? [];
        }
        setSchedule(sched);
        setDigestChoice(choice);
        setConds(cnd);
        setExceptIds(exc);
        setIncludeIds(inc);
        setTenantRoles(rls);
      } catch {
        /* non-blocking — falls back to the default schedule */
      }
    })();
    return () => {
      active = false;
    };
  }, [tenant]);

  // Recipient roles per category (live workflow `recip:` tags).
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/notification-recipients", { cache: "no-store" });
        const data = await res.json();
        if (!active || !data.ok) return;
        const map: Record<string, RecipConfig> = {};
        for (const c of data.configs as RecipConfig[]) if (c.category) map[c.category] = c;
        setRecip(map);
      } catch {
        /* recipients are non-blocking */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function commit(next: Row[]) {
    setRows(next);
    void saveRows(next);
  }
  function update(slug: string, patch: Partial<Row>) {
    if (!rows) return;
    commit(rows.map((r) => (r.category === slug ? { ...r, ...patch } : r)));
  }
  // A category is "off" for the project when ALL its channels are blocked —
  // SuprSend then doesn't send it. We also hide it from the preference center.
  function setActive(r: Row, on: boolean) {
    update(r.category, {
      blockedChannels: on ? [] : [...r.channels],
      visibleToSubscriber: on,
    });
  }
  function toggleChannel(r: Row, ch: string, on: boolean) {
    const blocked = on ? r.blockedChannels.filter((c) => c !== ch) : [...new Set([...r.blockedChannels, ch])];
    const allBlocked = r.channels.length > 0 && r.channels.every((c) => blocked.includes(c));
    update(r.category, { blockedChannels: blocked, visibleToSubscriber: !allBlocked });
  }

  async function saveRows(rs: Row[]) {
    setSaving(true);
    try {
      const edits = rs.map((r) => ({
        category: r.category,
        preference: r.preference, // null = inherit (workspace default)
        visibleToSubscriber: r.visibleToSubscriber,
        blockedChannels: r.blockedChannels,
      }));
      const res = await fetch("/api/admin/tenant-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }),
      });
      const data = await res.json();
      if (data.ok) setOriginal(JSON.stringify(rs));
      else toast.error("Couldn’t save", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setSaving(false);
    }
  }

  const savedUp = rows !== null && JSON.stringify(rows) === original;

  // Collapsible category sections.
  const { isCollapsed, toggle: toggleSection } = useCollapsibleSections();

  const sections = React.useMemo(() => groupBySection(rows ?? [], (r) => r.section), [rows]);

  return (
    <>
      <PageHeader
        title="Project notification settings"
        description={`Notification defaults for ${project.fullName}. A user’s own choice still wins.`}
        actions={
          rows !== null ? (
            <span className="text-xs text-muted-foreground">{saving ? "Saving…" : savedUp ? "All changes saved" : ""}</span>
          ) : undefined
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      {rows === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No categories yet"
          description="Add notification categories in SuprSend and they’ll appear here to set per-project settings."
        />
      ) : (
        <div className="max-h-[calc(100vh-13rem)] overflow-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[1160px] table-fixed text-sm">
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[6%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[18%]" />
              <col className="w-[8%]" />
              <col className="w-[16%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">
                  <HeaderTip label="Active" tip="Whether this project sends this notification at all. Off means no one on the project gets it." />
                </th>
                <th className="px-4 py-2 font-medium">
                  <HeaderTip label="Default" tip="The On / Off / Required starting point each member inherits here. A member can still change their own." />
                </th>
                <th className="px-4 py-2 font-medium">
                  <HeaderTip label="Frequency" tip="How often it’s sent — right away, or batched into a digest at a set time." />
                </th>
                <th className="px-4 py-2 font-medium">
                  <HeaderTip label="Recipients" tip="Which roles (or specific people) receive this notification." />
                </th>
                <th className="px-4 py-2 font-medium">
                  <HeaderTip label="Except" tip="People who never get this notification, even if their role is a recipient." />
                </th>
                <th className="px-4 py-2 font-medium">
                  <ChannelHeaderIcons />
                </th>
                <th className="px-4 py-2 font-medium">
                  <HeaderTip label="Conditions" tip="Extra rules that must be true to send — e.g. project cost over a threshold." />
                </th>
              </tr>
            </thead>
            <tbody>
              {sections.map((group) => {
                const collapsed = isCollapsed(group.section);
                return (
                <React.Fragment key={group.section}>
                  <SectionHeaderRow
                    label={group.section}
                    colSpan={8}
                    collapsed={collapsed}
                    onToggle={() => toggleSection(group.section)}
                  />
                  {!collapsed && group.items.map((r) => {
                    const active = !(r.channels.length > 0 && r.channels.every((c) => r.blockedChannels.includes(c)));
                    // No "inherit" choice — the value defaults to the workspace
                    // default and is editable from here.
                    const value: Pref = r.preference ?? r.categoryDefault;
                    const cfg = recip[r.category];
                    return (
                      <tr key={r.category} className={cn("border-b border-border last:border-0", !active && "opacity-50")}>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">{r.name}</div>
                          {r.description && <div className="mt-0.5 text-xs text-muted-foreground">{r.description}</div>}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Switch
                            size="sm"
                            checked={active}
                            onCheckedChange={(v) => setActive(r, v)}
                            aria-label={`Active: ${r.name}`}
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <select
                            value={value}
                            disabled={!active}
                            onChange={(e) => update(r.category, { preference: e.target.value as Pref })}
                            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-ring focus:outline-none disabled:opacity-50"
                          >
                            {(Object.keys(PREF_LABEL) as Pref[]).map((p) => (
                              <option key={p} value={p}>
                                {PREF_LABEL[p]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {/* Digest shown only where Keystone defined a schedule;
                              else sent immediately. The chip shows the resolved cadence
                              + whether it's the workspace default or a project override. */}
                          {schedule[r.category]?.length ? (
                            (() => {
                              const sched = schedule[r.category];
                              const resolved = resolveDigestChoice(sched, digestChoice[r.category] ?? {});
                              const defaultOpt = sched.find((o) => o.isDefault) ?? sched[0];
                              // Only an override if the resolved cadence differs from the default.
                              const overridden = Boolean(resolved && defaultOpt && digestSummary(resolved) !== digestSummary(defaultOpt));
                              return (
                                <div className="flex flex-col items-start gap-0.5">
                                  <DigestPill disabled={!active} summary={resolved ? digestSummary(resolved) : undefined}>
                                    <DigestFrequency
                                      schedule={sched}
                                      value={digestChoice[r.category] ?? {}}
                                      disabled={!active}
                                      onChange={(next) => saveTenantDigest(r.category, next)}
                                      onReset={() => resetTenantDigest(r.category)}
                                    />
                                  </DigestPill>
                                  <span className="text-[10px] leading-none text-muted-foreground">
                                    {overridden ? "default overridden" : "default"}
                                  </span>
                                </div>
                              );
                            })()
                          ) : (
                            <span className="text-xs text-muted-foreground">Immediate</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <RecipientCell
                            roles={(tenantRoles[r.category] ?? []) as PersonRole[]}
                            extraRoles={cfg?.extraRoles ?? []}
                            emails={cfg?.emails ?? []}
                            editable={active}
                            onChange={(next) => saveTenantRoles(r.category, next.roles)}
                            // "Other User" → this category's `include` list (always-notify,
                            // any role). Picker offers the org pool not already included.
                            candidates={allPeople.filter((p) => !(includeIds[r.category] ?? []).includes(p.distinctId))}
                            onAddMember={(id, role) => addInclude(r.category, id, role)}
                            members={(includeIds[r.category] ?? []).map(
                              (id) => allPeople.find((p) => p.distinctId === id) ?? { distinctId: id, name: id, email: null },
                            )}
                            onRemoveMember={(id) => removeInclude(r.category, id)}
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <ExceptCell
                            excluded={(exceptIds[r.category] ?? []).map(
                              (id) => allPeople.find((m) => m.distinctId === id) ?? { distinctId: id, name: id },
                            )}
                            members={allPeople}
                            editable={active}
                            onChange={(next) => saveTenantExcept(r.category, next)}
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-3">
                            {PREF_CHANNELS.map((ch) => {
                              const has = r.channels.includes(ch);
                              const on = has && !r.blockedChannels.includes(ch);
                              return (
                                <span key={ch} className="flex w-10 justify-center" title={CHANNEL_LABEL[ch] ?? ch}>
                                  {has ? (
                                    <Switch
                                      size="sm"
                                      checked={on}
                                      disabled={!active}
                                      onCheckedChange={(v) => toggleChannel(r, ch, v)}
                                      aria-label={`${CHANNEL_LABEL[ch] ?? ch} for ${r.name}`}
                                    />
                                  ) : (
                                    <span className="text-xs text-muted-foreground/40">—</span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <ConditionsCell
                            conditions={conds[r.category] ?? []}
                            editable={active}
                            canAuthor={false}
                            onChange={(next) => saveTenantConditions(r.category, next)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
