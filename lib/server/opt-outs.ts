// Opt-out analytics — "are employees opting out, and of what?" (mirrors the
// SuprSend dashboard's opt-out card). There is NO opt-out aggregate API, so we
// compute it from real preference state: read each LIVE employee's category prefs
// (hub) and count opt-outs per category + per channel. Reflects exactly what users
// toggle in User · Preferences.
import "server-only";
import { listUsers } from "@/lib/server/users";
import { getUserCategories } from "@/lib/server/subscriber-prefs";
import { getPreferenceConfig } from "@/lib/server/preference-config";
import { hasWorkspaceKeys } from "@/lib/server/workspace";
import type { TenantId } from "@/lib/tenants";
import type { Workspace } from "@/lib/workspaces";

/** Per-channel breakdown for a category: muted (user turned off a channel the
 *  category delivers by default) vs offByDefault (channel just isn't a default
 *  channel for this category, so it's off until someone turns it on). */
export interface ChannelOff {
  muted: number;
  byDefault: number;
}
export interface OptOutRow {
  category: string;
  name: string;
  userOptOut: number; // employees who ACTIVELY opted out of the category (their choice)
  defaultOptOut: number; // employees who inherited an off-by-default (never chose)
  channelOptOuts: Record<string, ChannelOff>; // channel → muted vs off-by-default counts
}
export interface OptOutSummary {
  totalUsers: number;
  usersOptedOut: number; // distinct employees who ACTIVELY opted out / muted a channel
  usersDefaultOff: number; // distinct employees off only because of an off-by-default
  rows: OptOutRow[];
}

export async function getOptOutSummary(ws: Workspace, tenantId: string): Promise<OptOutSummary> {
  if (!hasWorkspaceKeys(ws)) return { totalUsers: 0, usersOptedOut: 0, usersDefaultOff: 0, rows: [] };
  const emps = await listUsers(ws);
  const perEmployee = await Promise.all(emps.map((e) => getUserCategories(ws, e.distinctId, tenantId).catch(() => [])));

  // The channels a category normally delivers on (its default opt-in + mandatory
  // set). A channel is only an ACTIVE "mute" if the category normally sends it but
  // the user turned it off — a channel that was never a default (e.g. Slack on a
  // category whose defaults are Email+Inbox) is off-by-default, NOT a user mute.
  const defs = await getPreferenceConfig(ws.slug).catch(() => []);
  const normallyOn = new Map<string, Set<string>>(
    defs.map((d) => [d.category, new Set([...d.optInChannels, ...d.mandatoryChannels])]),
  );

  const byCat = new Map<string, OptOutRow>();
  const activeUsers = new Set<string>(); // actively opted out / muted a channel
  const defaultUsers = new Set<string>(); // off only via an off-by-default

  perEmployee.forEach((cats, i) => {
    const empId = emps[i].distinctId;
    for (const c of cats) {
      const row = byCat.get(c.category) ?? { category: c.category, name: c.name, userOptOut: 0, defaultOptOut: 0, channelOptOuts: {} };
      if (c.preference === "opt_out") {
        // original_preference null → never chose → inherited the off-by-default.
        if (c.original_preference == null) {
          row.defaultOptOut += 1;
          defaultUsers.add(empId);
        } else {
          row.userOptOut += 1;
          activeUsers.add(empId);
        }
      } else {
        // Category is ON for this user — record each channel that's off, split by
        // why: a channel the category delivers by default but the user turned off
        // = an ACTIVE mute; a channel that isn't a default for this category =
        // off BY DEFAULT (the per-channel API gives no "chose vs inherited" flag,
        // so the category's default channel set is how we tell them apart).
        const onSet = normallyOn.get(c.category);
        for (const ch of c.channels ?? []) {
          if (ch.preference !== "opt_out") continue;
          const cell = row.channelOptOuts[ch.channel] ?? { muted: 0, byDefault: 0 };
          if (onSet && onSet.has(ch.channel)) {
            cell.muted += 1;
            activeUsers.add(empId);
          } else {
            cell.byDefault += 1;
          }
          row.channelOptOuts[ch.channel] = cell;
        }
      }
      byCat.set(c.category, row);
    }
  });

  const rows = [...byCat.values()].sort(
    (a, b) => b.userOptOut - a.userOptOut || b.defaultOptOut - a.defaultOptOut,
  );
  // An employee counted as "default off" but who also actively opted out elsewhere
  // belongs in the active bucket only.
  for (const id of activeUsers) defaultUsers.delete(id);
  return { totalUsers: emps.length, usersOptedOut: activeUsers.size, usersDefaultOff: defaultUsers.size, rows };
}
