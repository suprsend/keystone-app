// Workspace notification-category config (the "Workspace defaults" surface).
// Self-contained ServiceToken client — does NOT touch shared workflow/template code.
//
// Source (verified): GET v1/{ws}/preference_category/ → { root_categories:[{root_category,
//   sections:[{name, categories:[{category, name, description, default_preference,
//   default_opt_in_channels, default_mandatory_channels}]}]}] }.
// Write: POST (PATCH/PUT → 405) v1/{ws}/preference_category/?commit=true — send the
//   FULL root_categories tree (exactly 3 roots). We read the live tree, apply edits
//   by slug, and POST it back so structure/sections are preserved.
import "server-only";
import type { WorkspaceSlug } from "@/lib/workspaces";
import { getWorkspace } from "@/lib/workspaces";
import { hasWorkspaceKeys, envPrefix } from "@/lib/server/workspace";
import type { DigestOption } from "@/components/preferences/digest-frequency";
import type { Condition } from "@/components/admin/conditions-cell";
import {
  ssScheduleToDigest,
  digestToSsSchedule,
  type SsDigestSchedule,
} from "@/lib/digest-schedule";
import {
  ssAttrsToConditions,
  mergeConditionsIntoAttrs,
  mergeRoleIntoAttrs,
  type SsConditionAttr,
} from "@/lib/condition-attributes";

// preference_category host: prod serves it from the management API; staging from a
// dedicated preferences host. Prefer SUPRSEND_PREF_MGMNT_URL (staging), else the
// shared mgmt URL, else prod default.
const MGMNT = (
  process.env.SUPRSEND_PREF_MGMNT_URL ||
  process.env.SUPRSEND_MGMNT_URL ||
  "https://management-api.suprsend.com"
).replace(/\/$/, "");

function authHeaders(): Record<string, string> {
  const token = process.env.SUPRSEND_SERVICE_TOKEN;
  if (!token) throw new Error("SUPRSEND_SERVICE_TOKEN is not set");
  return {
    Authorization: `ServiceToken ${token}`,
    "Content-Type": "application/json",
  };
}

// Management API path segment = the SuprSend workspace KEY (not our app slug).
function wsPath(ws: WorkspaceSlug): string {
  return process.env[`${envPrefix(getWorkspace(ws))}_WORKSPACE_KEY`] || ws;
}

export type Pref = "opt_in" | "opt_out" | "cant_unsubscribe";

interface RawCategory {
  category?: string;
  name: string;
  description?: string | null;
  default_preference: Pref;
  default_opt_in_channels?: string[] | null;
  default_mandatory_channels?: string[] | null;
  digest_schedule?: SsDigestSchedule | null;
  // SuprSend's preference_category endpoint returns the condition attributes under
  // `properties` now; some responses still use `condition_attributes`. Read either.
  condition_attributes?: SsConditionAttr[] | null;
  properties?: SsConditionAttr[] | null;
}
interface RawSection {
  name?: string | null;
  description?: string | null;
  tags?: string[] | null;
  categories?: RawCategory[] | null;
}
interface RawRoot {
  root_category: "system" | "transactional" | "promotional";
  sections?: RawSection[] | null;
}
interface PrefDoc {
  root_categories: RawRoot[];
}

export interface PrefCategory {
  root: string;
  section: string;
  category: string;
  name: string;
  description: string | null;
  preference: Pref;
  optInChannels: string[];
  mandatoryChannels: string[];
  /** Whether digest is enabled for this category (digest_schedule.enabled). When
   * false, notifications are sent immediately and the cadence options don't apply. */
  digestEnabled: boolean;
  /** The category's digest cadence options (workspace default), mapped from
   * SuprSend's digest_schedule. Empty when the category has no digest configured. */
  digest: DigestOption[];
  /** Integer-metric conditions (e.g. cost) from condition_attributes. The `role`
   * attribute is excluded here — it's surfaced as the Recipients column. */
  conditions: Condition[];
}

/** One edit from the admin UI, keyed by category slug. */
export interface PrefEdit {
  category: string;
  preference: Pref;
  optInChannels: string[];
  mandatoryChannels: string[];
}

async function readDoc(ws: WorkspaceSlug): Promise<PrefDoc> {
  const res = await fetch(
    `${MGMNT}/v1/${wsPath(ws)}/preference_category/?mode=live`,
    { headers: authHeaders(), cache: "no-store" },
  );
  if (!res.ok)
    throw new Error(`preference_category read failed (${res.status})`);
  return (await res.json()) as PrefDoc;
}

export async function getPreferenceConfig(
  ws: WorkspaceSlug,
): Promise<PrefCategory[]> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return [];
  const doc = await readDoc(ws);
  const out: PrefCategory[] = [];
  for (const root of doc.root_categories ?? []) {
    for (const sec of root.sections ?? []) {
      for (const c of sec.categories ?? []) {
        out.push({
          root: root.root_category,
          section: sec.name ?? "",
          category: c.category ?? "",
          name: c.name,
          description: c.description ?? null,
          preference: c.default_preference,
          optInChannels: c.default_opt_in_channels ?? [],
          mandatoryChannels: c.default_mandatory_channels ?? [],
          digestEnabled: c.digest_schedule?.enabled ?? false,
          digest: ssScheduleToDigest(c.digest_schedule),
          conditions: ssAttrsToConditions(
            c.properties ?? c.condition_attributes,
          ),
        });
      }
    }
  }
  return out;
}

export interface NewCategory {
  category: string;
  name: string;
  description?: string;
  default_preference: Pref;
  opt_in_channels: string[];
  /** Section to file it under (created if missing). Defaults to "Custom". */
  section?: string;
}

/**
 * Append a new sub-category to the live tree (under transactional → section) and
 * publish. Used by live create-notification so a new notification is preference-
 * gated and appears on subscribers' preference pages. Idempotent by slug.
 */
export async function addCategory(
  ws: WorkspaceSlug,
  c: NewCategory,
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const doc = await readDoc(ws);
  const trans = (doc.root_categories ?? []).find(
    (r) => r.root_category === "transactional",
  );
  if (!trans) return { ok: false, status: 500 };
  trans.sections = trans.sections ?? [];
  const sectionName = c.section ?? "Custom";
  let sec = trans.sections.find((s) => s.name === sectionName);
  if (!sec) {
    sec = { name: sectionName, categories: [] };
    trans.sections.push(sec);
  }
  sec.categories = sec.categories ?? [];
  if (!sec.categories.find((x) => x.category === c.category)) {
    sec.categories.push({
      category: c.category,
      name: c.name,
      description: c.description ?? null,
      default_preference: c.default_preference,
      default_opt_in_channels: c.opt_in_channels,
      default_mandatory_channels: null,
    });
  }
  const res = await fetch(
    `${MGMNT}/v1/${wsPath(ws)}/preference_category/?commit=true&commit_message=${encodeURIComponent("Added category from Keystone")}`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ root_categories: doc.root_categories }),
    },
  );
  return { ok: res.ok, status: res.status };
}

/**
 * Rename a category's DISPLAY name (keeping its slug → preference gating intact).
 * Read the live tree, change the matching category's `name`, re-commit. No-op if
 * the slug isn't found.
 */
export async function renameCategory(
  ws: WorkspaceSlug,
  slug: string,
  name: string,
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const doc = await readDoc(ws);
  let found = false;
  for (const root of doc.root_categories ?? []) {
    for (const sec of root.sections ?? []) {
      for (const c of sec.categories ?? []) {
        if (c.category === slug) {
          c.name = name;
          found = true;
        }
      }
    }
  }
  if (!found) return { ok: false, status: 404 };
  const res = await fetch(
    `${MGMNT}/v1/${wsPath(ws)}/preference_category/?commit=true&commit_message=${encodeURIComponent("Renamed category from Keystone")}`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ root_categories: doc.root_categories }),
    },
  );
  return { ok: res.ok, status: res.status };
}

/** Set a category's digest_schedule (workspace default cadence options) and commit.
 * `options` empty → digest_schedule:null (remove). Read the live tree, set by slug,
 * POST it back so the rest of the tree is preserved. */
export async function saveCategoryDigest(
  ws: WorkspaceSlug,
  slug: string,
  options: DigestOption[],
  enabled: boolean,
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const doc = await readDoc(ws);
  let found = false;
  for (const root of doc.root_categories ?? []) {
    for (const sec of root.sections ?? []) {
      for (const c of sec.categories ?? []) {
        if (c.category === slug) {
          // enabled → set the schedule; disabled → null (off, sent immediately) per
          // SuprSend's "remove" convention.
          c.digest_schedule = enabled
            ? { ...digestToSsSchedule(options), enabled: true }
            : null;
          found = true;
        }
      }
    }
  }
  if (!found) return { ok: false, status: 404 };
  const res = await fetch(
    `${MGMNT}/v1/${wsPath(ws)}/preference_category/?commit=true&commit_message=${encodeURIComponent("Digest schedule from Keystone")}`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ root_categories: doc.root_categories }),
    },
  );
  return { ok: res.ok, status: res.status };
}

/** Set a category's condition_attributes (managed integer metrics, e.g. cost) and
 * commit — PRESERVING any unmanaged attributes (notably `role`/Recipients). */
export async function saveCategoryConditions(
  ws: WorkspaceSlug,
  slug: string,
  conditions: Condition[],
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const doc = await readDoc(ws);
  let found = false;
  for (const root of doc.root_categories ?? []) {
    for (const sec of root.sections ?? []) {
      for (const c of sec.categories ?? []) {
        if (c.category === slug) {
          c.properties = mergeConditionsIntoAttrs(
            c.properties ?? c.condition_attributes,
            conditions,
          );
          found = true;
        }
      }
    }
  }
  if (!found) return { ok: false, status: 404 };
  const res = await fetch(
    `${MGMNT}/v1/${wsPath(ws)}/preference_category/?commit=true&commit_message=${encodeURIComponent("Conditions from Keystone")}`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ root_categories: doc.root_categories }),
    },
  );
  return { ok: res.ok, status: res.status };
}

/** Set a category's recipient roles (the `role` condition attribute default) and
 * commit — PRESERVING cost/include/except. This is the WORKSPACE default the workflow
 * condition ($category.properties.role) falls back to when a project has no tenant
 * override, so editing Recipients on the admin screen actually drives delivery
 * (mirrors saveTenantRoles, which does the same at the per-project tenant level). */
export async function saveCategoryRoles(
  ws: WorkspaceSlug,
  slug: string,
  roles: string[],
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const doc = await readDoc(ws);
  let found = false;
  for (const root of doc.root_categories ?? []) {
    for (const sec of root.sections ?? []) {
      for (const c of sec.categories ?? []) {
        if (c.category === slug) {
          c.properties = mergeRoleIntoAttrs(c.properties ?? c.condition_attributes, roles);
          found = true;
        }
      }
    }
  }
  if (!found) return { ok: false, status: 404 };
  const res = await fetch(
    `${MGMNT}/v1/${wsPath(ws)}/preference_category/?commit=true&commit_message=${encodeURIComponent("Recipients from Keystone")}`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ root_categories: doc.root_categories }),
    },
  );
  return { ok: res.ok, status: res.status };
}

/** Apply edits (by slug) to the live tree and commit a new version. */
export async function savePreferenceConfig(
  ws: WorkspaceSlug,
  edits: PrefEdit[],
): Promise<{ ok: boolean; status: number }> {
  // Mock mode: no service token to commit a new version — accept edits as a no-op.
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const doc = await readDoc(ws);
  const bySlug = new Map(edits.map((e) => [e.category, e]));
  for (const root of doc.root_categories ?? []) {
    for (const sec of root.sections ?? []) {
      for (const c of sec.categories ?? []) {
        const e = c.category ? bySlug.get(c.category) : undefined;
        if (!e) continue;
        const cantUnsub = e.preference === "cant_unsubscribe";
        c.default_preference = e.preference;
        // Always set the on-by-default channel set. For a Required (cant_unsubscribe)
        // category, ALSO mark those channels mandatory (locked). Verified empirically:
        // setting ONLY mandatory left the other channels on+editable for new hires —
        // setting opt_in too turns the UNSELECTED channels OFF by default (the
        // intuitive result). For opt_out, SuprSend ignores opt_in channels anyway.
        c.default_opt_in_channels = e.optInChannels;
        c.default_mandatory_channels = cantUnsub ? e.mandatoryChannels : null;
      }
    }
  }
  const res = await fetch(
    `${MGMNT}/v1/${wsPath(ws)}/preference_category/?commit=true&commit_message=${encodeURIComponent("Updated from Keystone")}`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ root_categories: doc.root_categories }),
    },
  );
  return { ok: res.ok, status: res.status };
}
