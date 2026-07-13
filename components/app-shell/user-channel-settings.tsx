"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { CHANNEL_ICON, CHANNEL_LABEL } from "@/lib/message-display";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { DigestFrequency, type DigestOption, type DigestChoice, defaultDigestSchedule } from "@/components/preferences/digest-frequency";
import { PREF_CHANNELS, groupBySection } from "@/lib/preferences";
import { DummyChannelSwitch } from "@/components/preferences/dummy-channel";
import { SectionHeaderRow } from "@/components/preferences/section-table";
import { cn } from "@/lib/utils";

// The user's own notification settings (Account → Notifications): per category, the
// delivery Frequency (Instant = real-time, anything else = a digest at that cadence)
// and the Channels. These are the user's GLOBAL preferences (customer level).
//
// The Frequency shown is the RESOLVED value the user currently has, and the dropdown
// offers only the cadences ALLOWED upstream (per category) — the user overrides by
// picking within that set. No "default/source" label: the user doesn't need to know
// where the current value came from.
//
// UI only for now — flip USE_API to true and fill the two seams (loadPrefs /
// persistPref) to wire it to SuprSend; the UI then works unchanged.

interface Cat {
  category: string;
  name: string;
  section: string;
  description: string | null;
}

// Per-category saved state the API returns: the digest schedule allowed upstream
// (admin-defined cadence options), the user's chosen option + time, and the channel
// on/off map. The user picks a cadence within `schedule`; a time only when the
// chosen option lets users set it.
interface SavedPref {
  schedule: DigestOption[];
  choice?: DigestChoice;
  channels: Record<string, boolean>;
}

// ── API SEAM ────────────────────────────────────────────────────────────────
// When the SuprSend endpoints are ready: set USE_API = true and implement these.
// loadPrefs() → map each category → { schedule, choice, channels }, where
//   `schedule` is the admin-allowed cadence options and `choice` the user's pick.
// persistPref(category, patch) → save a change (a DigestChoice, or { channel, on }).
// Until then the UI runs on local state with sensible defaults.
const USE_API = false;
async function loadPrefs(): Promise<Record<string, SavedPref> | null> {
  // e.g. GET /api/user-preferences → map category → { schedule, choice, channels }
  return null;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function persistPref(category: string, patch: DigestChoice & { channel?: string; on?: boolean }): Promise<void> {
  // e.g. PATCH /api/user-preferences { category, ...patch }
}
// ─────────────────────────────────────────────────────────────────────────────

export function UserChannelSettings() {
  const [cats, setCats] = React.useState<Cat[] | null>(null);
  const [on, setOn] = React.useState<Record<string, Record<string, boolean>>>({});
  // The admin-allowed cadence options per category, and the user's chosen
  // option (+ any dimensions the admin let users set).
  const [schedule, setSchedule] = React.useState<Record<string, DigestOption[]>>({});
  const [sel, setSel] = React.useState<Record<string, DigestChoice>>({});

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/preference-config", { cache: "no-store" });
        const d = await res.json();
        if (!active) return;
        if (!d.ok) {
          setCats([]);
          return;
        }
        const list: Cat[] = (d.categories as Cat[]).map((c) => ({
          category: c.category,
          name: c.name,
          section: c.section,
          description: c.description ?? null,
        }));
        setCats(list);

        // Saved prefs from SuprSend when wired; otherwise local defaults.
        const saved = USE_API ? await loadPrefs() : null;
        const initOn: Record<string, Record<string, boolean>> = {};
        const initSchedule: Record<string, DigestOption[]> = {};
        const initSel: Record<string, DigestChoice> = {};
        for (const c of list) {
          initOn[c.category] = saved?.[c.category]?.channels ?? { email: true, inbox: true, slack: false };
          // The cadence options the admin allows for this category, and the user's
          // current pick. Stub: a representative schedule, defaulting to its default.
          initSchedule[c.category] = saved?.[c.category]?.schedule ?? defaultDigestSchedule();
          initSel[c.category] = saved?.[c.category]?.choice ?? {};
        }
        if (!active) return;
        setOn(initOn);
        setSchedule(initSchedule);
        setSel(initSel);
      } catch {
        if (active) setCats([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function toggleChannel(cat: string, ch: string) {
    setOn((m) => {
      const next = !m[cat]?.[ch];
      void persistPref(cat, { channel: ch, on: next });
      return { ...m, [cat]: { ...m[cat], [ch]: next } };
    });
  }

  function setDigest(cat: string, next: DigestChoice) {
    setSel((m) => ({ ...m, [cat]: next }));
    void persistPref(cat, next);
  }

  if (cats === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (cats.length === 0) {
    return <EmptyState icon={SlidersHorizontal} title="No notifications" description="Nothing to configure yet." />;
  }

  const groups = groupBySection(cats, (c) => c.section);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/60">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Category</th>
            <th className="px-4 py-2 font-medium">Frequency</th>
            <th className="px-4 py-2 font-medium">Channel</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <React.Fragment key={group.section}>
              <SectionHeaderRow label={group.section} colSpan={3} />
              {group.items.map((c) => (
                <tr key={c.category} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium">{c.name}</div>
                    {c.description && <div className="mt-0.5 text-xs text-muted-foreground">{c.description}</div>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <DigestFrequency
                      schedule={schedule[c.category] ?? defaultDigestSchedule()}
                      value={sel[c.category] ?? {}}
                      onChange={(next) => setDigest(c.category, next)}
                    />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {PREF_CHANNELS.map((ch) => {
                        const Icon = CHANNEL_ICON[ch];
                        const isOn = on[c.category]?.[ch] ?? false;
                        return (
                          <label key={ch} className="flex items-center gap-1.5 text-xs">
                            {Icon && <Icon className={cn("size-3.5", (ch === "slack" || isOn) ? "text-foreground" : "text-muted-foreground")} />}
                            <span className={cn((ch === "slack" || isOn) ? "text-foreground" : "text-muted-foreground")}>
                              {CHANNEL_LABEL[ch] ?? ch}
                            </span>
                            {ch === "slack" ? (
                              <DummyChannelSwitch size="sm" />
                            ) : (
                              <Switch size="sm" checked={isOn} onCheckedChange={() => toggleChannel(c.category, ch)} />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
