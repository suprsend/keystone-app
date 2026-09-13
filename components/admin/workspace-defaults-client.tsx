"use client";

import * as React from "react";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import type { PrefCategory, Pref } from "@/lib/server/preference-config";
import type { PersonRole } from "@/lib/people";
import { useAppState } from "@/components/providers";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { RecipientCell, type Recipients } from "@/components/admin/recipient-cell";
import { ConditionsCell, type Condition } from "@/components/admin/conditions-cell";
import { DigestCell } from "@/components/admin/digest-schedule";
import { type DigestOption } from "@/components/preferences/digest-frequency";
import { CHANNEL_LABEL } from "@/lib/message-display";
import { PREF_CHANNELS, PREF_LABEL, groupBySection } from "@/lib/preferences";
import { useCollapsibleSections, SectionHeaderRow, ChannelHeaderIcons } from "@/components/preferences/section-table";

// WORKSPACE (account-level) notification defaults — applied across every project
// in the customer, unless a project or user overrides. Same table shape as the
// project view EXCEPT there's no "Active" column (Active = a project opting out of
// the workspace default, which has no meaning at the workspace level itself).
//  • Default     — the workspace default preference (On / Off / Mandatory).
//  • Recipients  — which roles the notification targets (live workflow recip: tags;
//    per-notification / workspace-wide — same config the project view shows).
//  • Channel     — the default channels.
//  • Conditions  — extra gates the workflow evaluates on top of role, e.g. the cost
//    threshold Budget Alert must exceed before it sends.
interface Row extends PrefCategory {
  channels: string[]; // unified default-channel set (routed by preference on save)
}

interface RecipConfig {
  slug: string;
  category: string;
  roles: PersonRole[];
  /** Dashboard-managed roles the app displays but never edits. */
  extraRoles?: string[];
  emails: string[];
}

export function WorkspaceDefaultsClient() {
  const { workspace } = useAppState();
  return <Body key={workspace} />;
}

function Body() {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [original, setOriginal] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // category slug → live recipient config (workflow slug + roles).
  const [recip, setRecip] = React.useState<Record<string, RecipConfig>>({});
  // UI-only (API wired later): the workspace digest schedule + the conditions that
  // gate each notification. category slug → value.
  const [digest, setDigest] = React.useState<Record<string, DigestOption[]>>({});
  const [digestEnabled, setDigestEnabled] = React.useState<Record<string, boolean>>({});
  const [conds, setConds] = React.useState<Record<string, Condition[]>>({});

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/preference-config", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!data.ok) {
          setError(data.error ?? "Couldn’t load defaults.");
          setRows([]);
          return;
        }
        const mapped: Row[] = (data.categories as PrefCategory[]).map((c) => ({
          ...c,
          channels: c.preference === "cant_unsubscribe" ? c.mandatoryChannels : c.optInChannels,
        }));
        setRows(mapped);
        setOriginal(JSON.stringify(mapped));
        // Seed each category's digest from the live workspace config; fall back to
        // the full cadence set for categories with no digest configured yet.
        const initDigest: Record<string, DigestOption[]> = {};
        const initEnabled: Record<string, boolean> = {};
        const initConds: Record<string, Condition[]> = {};
        for (const c of mapped) {
          initDigest[c.category] = c.digest ?? [];
          initEnabled[c.category] = c.digestEnabled;
          initConds[c.category] = c.conditions ?? [];
        }
        setDigest(initDigest);
        setDigestEnabled(initEnabled);
        setConds(initConds);
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

  // Recipient roles per category (live workflow recip: tags — workspace-wide).
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
  function toggleChannel(slug: string, ch: string) {
    if (!rows) return;
    commit(
      rows.map((r) =>
        r.category === slug
          ? { ...r, channels: r.channels.includes(ch) ? r.channels.filter((c) => c !== ch) : [...r.channels, ch] }
          : r,
      ),
    );
  }

  // Save a category's digest schedule (enabled + cadences) to SuprSend.
  async function saveDigest(slug: string, options: DigestOption[], enabled: boolean) {
    setDigest((m) => ({ ...m, [slug]: options }));
    setDigestEnabled((m) => ({ ...m, [slug]: enabled }));
    setSaving(true);
    try {
      const res = await fetch("/api/admin/preference-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest: { category: slug, options, enabled } }),
      });
      const data = await res.json();
      if (!data.ok) toast.error("Couldn’t save digest", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setSaving(false);
    }
  }

  // Save a category's conditions (managed metrics, e.g. cost) to SuprSend.
  async function saveConditions(slug: string, conditions: Condition[]) {
    setConds((m) => ({ ...m, [slug]: conditions }));
    setSaving(true);
    try {
      const res = await fetch("/api/admin/preference-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditions: { category: slug, conditions } }),
      });
      const data = await res.json();
      if (!data.ok) toast.error("Couldn’t save conditions", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRows(rs: Row[]) {
    setSaving(true);
    try {
      const edits = rs.map((r) => ({
        category: r.category,
        preference: r.preference,
        optInChannels: r.channels,
        mandatoryChannels: r.channels,
      }));
      const res = await fetch("/api/admin/preference-config", {
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

  // Live recipient write (recip:/recipuser: tags on the workflow).
  async function setRecipients(categorySlug: string, next: Recipients) {
    const cfg = recip[categorySlug];
    if (!cfg) return;
    setRecip((m) => ({ ...m, [categorySlug]: { ...cfg, roles: next.roles, emails: next.emails } }));
    try {
      const res = await fetch("/api/admin/notification-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: cfg.slug, roles: next.roles, emails: next.emails, category: categorySlug }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast.error("Couldn’t save recipients", { description: data.error });
        setRecip((m) => ({ ...m, [categorySlug]: cfg }));
      }
    } catch {
      toast.error("Couldn’t reach SuprSend.");
      setRecip((m) => ({ ...m, [categorySlug]: cfg }));
    }
  }

  const savedUp = rows !== null && JSON.stringify(rows) === original;

  const { isCollapsed, toggle: toggleSection } = useCollapsibleSections();

  const sections = React.useMemo(() => groupBySection(rows ?? [], (r) => r.section), [rows]);

  return (
    <>
      <PageHeader
        title="Preferences"
        description="Account-level notification defaults — the default preference, recipients and channels for each notification, applied across every project in this workspace. Changes save automatically."
        actions={
          <div className="flex items-center gap-3">
            {rows !== null && (
              <span className="text-xs text-muted-foreground">{saving ? "Saving…" : savedUp ? "All changes saved" : ""}</span>
            )}
          </div>
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
          icon={SlidersHorizontal}
          title="No categories yet"
          description="Add notification categories in SuprSend and they’ll appear here for you to set defaults and channels."
        />
      ) : (
        <div className="max-h-[calc(100vh-13rem)] overflow-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[960px] table-fixed text-sm">
            <colgroup>
              <col className="w-[21%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[21%]" />
              <col className="w-[16%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Default</th>
                <th className="px-4 py-2 font-medium">Frequency</th>
                <th className="px-4 py-2 font-medium">Recipients</th>
                <th className="px-4 py-2 font-medium">
                  <ChannelHeaderIcons />
                </th>
                <th className="px-4 py-2 font-medium">Conditions</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((group) => {
                const collapsed = isCollapsed(group.section);
                return (
                <React.Fragment key={group.section}>
                  <SectionHeaderRow
                    label={group.section}
                    colSpan={6}
                    collapsed={collapsed}
                    onToggle={() => toggleSection(group.section)}
                  />
                  {!collapsed && group.items.map((r) => {
                    const off = r.preference === "opt_out";
                    const cfg = recip[r.category];
                    return (
                      <tr key={r.category} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">{r.name}</div>
                          {r.description && <div className="mt-0.5 text-xs text-muted-foreground">{r.description}</div>}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <select
                            value={r.preference}
                            onChange={(e) => update(r.category, { preference: e.target.value as Pref })}
                            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-ring focus:outline-none"
                          >
                            {(Object.keys(PREF_LABEL) as Pref[]).map((p) => (
                              <option key={p} value={p}>
                                {PREF_LABEL[p]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {/* Digest is shown only where Keystone DEFINED a schedule
                              (digest_schedule.enabled, from the API). Adjust-only here —
                              the customer tunes values; it can't enable digest on a
                              workflow that doesn't use one. Else: sent immediately. */}
                          {digestEnabled[r.category] ? (
                            <DigestCell
                              enabled
                              canAuthor={false}
                              schedule={digest[r.category] ?? []}
                              disabled={off}
                              onChange={(en, next) => saveDigest(r.category, next, en)}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">Immediate</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <RecipientCell
                            roles={cfg?.roles ?? []}
                            extraRoles={cfg?.extraRoles ?? []}
                            emails={cfg?.emails ?? []}
                            editable={Boolean(cfg)}
                            onChange={(next) => setRecipients(r.category, next)}
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-3">
                            {PREF_CHANNELS.map((ch) => {
                              const on = r.channels.includes(ch);
                              return (
                                <span key={ch} className="flex w-10 justify-center" title={CHANNEL_LABEL[ch] ?? ch}>
                                  <Switch
                                    size="sm"
                                    checked={on}
                                    disabled={off}
                                    onCheckedChange={() => toggleChannel(r.category, ch)}
                                    aria-label={`${CHANNEL_LABEL[ch] ?? ch} for ${r.name}`}
                                  />
                                </span>
                              );
                            })}
                          </div>
                          {off && (
                            <div className="mt-1 text-[11px] text-muted-foreground">Off by default — channels apply once turned on.</div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <ConditionsCell
                            conditions={conds[r.category] ?? []}
                            editable
                            canAuthor={false}
                            onChange={(next) => saveConditions(r.category, next)}
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

