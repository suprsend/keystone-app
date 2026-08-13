// Admin-scoped read/write of ONE employee's notification preferences (the Per-user
// support tool). Server-side: we mint a subscriber JWT for the picked distinct_id
// (same ES256 signing key as /api/subscriber-token) and call hub directly — the
// node SDK has no preference methods, so this is the supported path.
//
// Verified: GET  hub/v2/subscriber/{id}/category/?tenant_id=default → {results:[...]}
//           PATCH hub/v2/subscriber/{id}/category/{cat}/ {category, preference,
//                 opt_out_channels, is_editable} → 202. Channel-level prefs ride on
//                 opt_out_channels (BTS model), not a separate endpoint.
import "server-only";
import jwt from "jsonwebtoken";
import { getWorkspaceSecrets, publicEnvPrefix, hasWorkspaceKeys } from "@/lib/server/workspace";
import { getPreferenceConfig } from "@/lib/server/preference-config";
import type { Workspace } from "@/lib/workspaces";

const HOST = (process.env.SUPRSEND_HOST || "https://hub.suprsend.com/").replace(/\/$/, "");

function headers(ws: Workspace, distinctId: string, tenantId: string): Record<string, string> {
  const { signingKeyB64, signingKeyId } = getWorkspaceSecrets(ws);
  const prefix = publicEnvPrefix(ws);
  const publicApiKey = process.env[`${prefix}_PUBLIC_KEY`];
  if (!publicApiKey) throw new Error(`public key not configured for ${ws.slug}`);
  const privateKey = Buffer.from(signingKeyB64, "base64").toString("utf-8");
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { entity_type: "subscriber", entity_id: distinctId, iat: now, exp: now + 600, scope: { tenant_id: tenantId } },
    privateKey,
    { algorithm: "ES256", header: { alg: "ES256", typ: "JWT", kid: signingKeyId } },
  );
  return { "Content-Type": "application/json", Authorization: publicApiKey, "x-ss-signature": token };
}

export interface UserCategoryChannel {
  channel: string;
  preference: "opt_in" | "opt_out";
  is_editable?: boolean;
}
/** One condition attribute on a category, as the subscriber API returns it.
 *  `value` is THIS user's override — null means they inherit the project's (or the
 *  workspace's) value, which is what `default_value` carries. */
export interface UserCategoryProperty {
  key: string;
  label: string;
  value_type: string;
  value: unknown;
  default_value: unknown;
  edit_policy?: "editable" | "locked";
}

export interface UserCategory {
  category: string;
  name: string;
  description?: string | null;
  preference: "opt_in" | "opt_out" | "cant_unsubscribe";
  /** Condition attributes (role / except / include / cost) with this user's overrides. */
  properties?: UserCategoryProperty[] | null;
  // null = the user never set this → they inherit the workspace default.
  // non-null = the user actively chose this preference themselves.
  original_preference?: "opt_in" | "opt_out" | "cant_unsubscribe" | null;
  is_editable?: boolean;
  channels?: UserCategoryChannel[] | null;
  // The parent section (e.g. "Work Order Related") — the subscriber API returns a
  // flat list, so we enrich it from the category config for grouped display.
  section?: string;
}

export async function getUserCategories(ws: Workspace, distinctId: string, tenantId: string): Promise<UserCategory[]> {
  if (!hasWorkspaceKeys(ws)) return [];
  const res = await fetch(
    `${HOST}/v2/subscriber/${encodeURIComponent(distinctId)}/category/?tenant_id=${encodeURIComponent(tenantId)}&show_opt_out_channels=true`,
    { headers: headers(ws, distinctId, tenantId), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`preferences read failed (${res.status})`);
  const body = (await res.json()) as { results?: UserCategory[] };
  const cats = body.results ?? [];
  // Enrich each category with its parent section (the subscriber API returns a
  // flat list; the section structure lives in the category config) so the UI can
  // group main category → sub-category. Non-fatal if the config can't be read.
  try {
    const config = await getPreferenceConfig(ws.slug);
    const sectionByCat = new Map(config.map((c) => [c.category, c.section]));
    for (const c of cats) c.section = sectionByCat.get(c.category) ?? "";
  } catch {
    // leave sections undefined — the UI falls back to a single group
  }
  return cats;
}

export async function updateUserCategory(
  ws: Workspace,
  distinctId: string,
  category: string,
  preference: "opt_in" | "opt_out",
  optOutChannels: string[],
  tenantId: string,
): Promise<{ ok: boolean; status: number }> {
  // No-keys mode: no keys to sign a subscriber JWT — accept the toggle as a no-op.
  if (!hasWorkspaceKeys(ws)) return { ok: true, status: 200 };
  const res = await fetch(
    `${HOST}/v2/subscriber/${encodeURIComponent(distinctId)}/category/${encodeURIComponent(category)}/?tenant_id=${encodeURIComponent(tenantId)}`,
    {
      method: "PATCH",
      headers: headers(ws, distinctId, tenantId),
      body: JSON.stringify({ category, preference, opt_out_channels: optOutChannels, is_editable: true }),
    },
  );
  return { ok: res.ok, status: res.status };
}

/**
 * Override ONE condition attribute for this user on a category — the user-level twin
 * of saveTenantConditions. Sending `null` clears the override so the user goes back
 * to inheriting the project's value.
 *
 * Other attributes the user has already overridden are read back and re-sent, because
 * the PATCH replaces the whole `properties` array (same contract as the tenant route).
 */
export async function saveUserCondition(
  ws: Workspace,
  distinctId: string,
  category: string,
  tenantId: string,
  key: string,
  value: unknown,
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(ws)) return { ok: true, status: 200 };
  const current = await getUserCategories(ws, distinctId, tenantId);
  const cat = current.find((c) => c.category === category);
  const preserved = (cat?.properties ?? [])
    .filter((p) => p.key !== key && p.value !== null && p.value !== undefined)
    .map((p) => ({ key: p.key, value: p.value }));
  const properties = value === null ? preserved : [...preserved, { key, value }];
  const url = `${HOST}/v2/subscriber/${encodeURIComponent(distinctId)}/category/${encodeURIComponent(category)}/?tenant_id=${encodeURIComponent(tenantId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(ws, distinctId, tenantId),
    // `preference` is required on this endpoint even when only properties change —
    // resend the user's current on/off so the write doesn't flip it.
    body: JSON.stringify({
      category,
      preference: cat?.preference === "opt_out" ? "opt_out" : "opt_in",
      properties,
    }),
  });
  return { ok: res.ok, status: res.status };
}
