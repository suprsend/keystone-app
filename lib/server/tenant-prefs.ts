// Tenant-level (per-project) default preferences — the "admin sets the default for
// everyone on this project" surface. These live on the Hub REST API (NOT the
// Management API): GET /v1/tenant/{tenant}/category/ and PATCH the same per category.
//
// Auth is the SuprSend signed-request scheme (key + HMAC-SHA256 over
// verb\ncontentMd5\ncontentType\nDate\npath), same as the node SDK — the SDK has
// no category-preference method, so we sign the request ourselves.
//
// Precedence (SuprSend): user preference → TENANT default → category default.
// So a tenant default applies to every user on that project who hasn't set their
// own choice. See [[wellspring-build-state]] + docs/tenant-preference.
import "server-only";
import crypto from "crypto";
import type { WorkspaceSlug } from "@/lib/workspaces";
import { getWorkspace } from "@/lib/workspaces";
import { hasWorkspaceKeys, envPrefix } from "@/lib/server/workspace";
import type { DigestOption, DigestChoice } from "@/components/preferences/digest-frequency";
import type { Condition } from "@/components/admin/conditions-cell";
import { ssScheduleToDigest, digestToSsOption, digestToUserPick, userPickToChoice, type SsDigestOption, type SsUserPick } from "@/lib/digest-schedule";
import { type SsConditionAttr } from "@/lib/condition-attributes";

const HUB = (process.env.SUPRSEND_HOST || "https://hub.suprsend.com").replace(/\/$/, "");

// The per-category preference endpoint that carries digest_schedule + condition
// overrides (verified on staging: same host + signed auth as the category route).
const prefUrl = (tenant: string, category: string) =>
  `${HUB}/v1/tenant/${encodeURIComponent(tenant)}/preference/category/${encodeURIComponent(category)}/`;

export type Pref = "opt_in" | "opt_out" | "cant_unsubscribe";

export interface TenantCategoryPref {
  category: string;
  /** null = no tenant override (inherits the category default). */
  preference: Pref | null;
  visibleToSubscriber: boolean;
  optInChannels: string[] | null;
  mandatoryChannels: string[] | null;
  blockedChannels: string[] | null;
}

/** One admin edit, keyed by category slug. `preference: null` clears the tenant
 * override so the category falls back to the org/category default.
 * `blockedChannels` = channels this tenant opts OUT of for the category. */
export interface TenantPrefEdit {
  category: string;
  preference: Pref | null;
  visibleToSubscriber: boolean;
  blockedChannels?: string[];
}

function creds(ws: WorkspaceSlug): { key: string; secret: string } {
  const prefix = envPrefix(getWorkspace(ws));
  const key = process.env[`${prefix}_WORKSPACE_KEY`];
  const secret = process.env[`${prefix}_WORKSPACE_SECRET`];
  if (!key || !secret) throw new Error(`Missing workspace key/secret for ${ws}`);
  return { key, secret };
}

function signedHeaders(ws: WorkspaceSlug, url: string, verb: string, body?: string): Record<string, string> {
  const { key, secret } = creds(ws);
  const date = new Date().toUTCString();
  const contentType = "application/json; charset=utf-8";
  const contentMd5 = body ? crypto.createHash("md5").update(body).digest("hex") : "";
  const u = new URL(url);
  const path = u.pathname + u.search;
  const signString = `${verb}\n${contentMd5}\n${contentType}\n${date}\n${path}`;
  const signature = crypto.createHmac("sha256", secret).update(signString).digest("base64");
  return { "Content-Type": contentType, Date: date, Authorization: `${key}:${signature}` };
}

interface RawTenantCat {
  category?: string;
  preference?: Pref | null;
  visible_to_subscriber?: boolean | null;
  opt_in_channels?: string[] | null;
  mandatory_channels?: string[] | null;
  blocked_channels?: string[] | null;
}

/** All category default preferences for a tenant (project). */
export async function getTenantCategoryPrefs(ws: WorkspaceSlug, tenantId: string): Promise<TenantCategoryPref[]> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return [];
  const url = `${HUB}/v1/tenant/${encodeURIComponent(tenantId)}/category/`;
  const res = await fetch(url, { headers: signedHeaders(ws, url, "GET"), cache: "no-store" });
  if (!res.ok) throw new Error(`tenant category read failed (${res.status})`);
  const body = (await res.json()) as { results?: RawTenantCat[] } | RawTenantCat[];
  const list = Array.isArray(body) ? body : body.results ?? [];
  return list.map((c) => ({
    category: c.category ?? "",
    preference: c.preference ?? null,
    visibleToSubscriber: c.visible_to_subscriber !== false,
    optInChannels: c.opt_in_channels ?? null,
    mandatoryChannels: c.mandatory_channels ?? null,
    blockedChannels: c.blocked_channels ?? null,
  }));
}

/** Update one tenant category default (preference + visibility). */
export async function updateTenantCategoryPref(
  ws: WorkspaceSlug,
  tenantId: string,
  edit: TenantPrefEdit,
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const url = `${HUB}/v1/tenant/${encodeURIComponent(tenantId)}/category/${encodeURIComponent(edit.category)}/`;
  const payload = JSON.stringify({
    preference: edit.preference,
    visible_to_subscriber: edit.visibleToSubscriber,
    ...(edit.blockedChannels ? { blocked_channels: edit.blockedChannels } : {}),
  });
  const res = await fetch(url, { method: "PATCH", headers: signedHeaders(ws, url, "PATCH", payload), body: payload });
  return { ok: res.ok, status: res.status };
}

// ── Digest + conditions (the new preference endpoint) ─────────────────────────
// The tenant OVERRIDES within what the workspace allows: digest_schedule has
// `original_options` (allowed, read-only) + `options` (this tenant's override,
// empty = inherit); each condition_attribute carries the workspace default plus a
// per-tenant `value`/`is_overridden`. Verified PATCH semantics on staging:
//   override digest → { digest_schedule: { options: [chosen] } }; inherit → options: []
//   override cost   → { condition_attributes: [{ key, value }] };   inherit → []

type RawAttr = SsConditionAttr & { value?: unknown; is_overridden?: boolean };
interface RawTenantPref {
  digest_schedule?: { original_options?: SsDigestOption[]; options?: SsDigestOption[] } | null;
  // The SuprSend tenant/category endpoint returns the (effective) condition attributes
  // under `properties`; some responses still use `condition_attributes`. Read either.
  condition_attributes?: RawAttr[] | null;
  properties?: RawAttr[] | null;
}

async function getRawTenantPref(ws: WorkspaceSlug, tenant: string, category: string): Promise<RawTenantPref> {
  const url = prefUrl(tenant, category);
  const res = await fetch(url, { headers: signedHeaders(ws, url, "GET"), cache: "no-store" });
  if (!res.ok) throw new Error(`tenant preference read failed (${res.status})`);
  return (await res.json()) as RawTenantPref;
}

export interface TenantPrefExtras {
  category: string;
  digestSchedule: DigestOption[]; // original_options — the allowed set (read-only)
  digestOverride: DigestOption[]; // options — this tenant's override (empty = inherit)
  conditions: Condition[]; // effective cost (override value if set, else default)
  except: string[]; // effective excluded distinct_ids (from the `except` attribute)
  include: string[]; // effective always-notify distinct_ids (from the `include` attribute)
  roles: string[]; // effective recipient roles (from the `role` attribute)
}

// The effective value of a list_choice condition attribute (override if set, else default).
function effectiveList(a?: (SsConditionAttr & { value?: unknown; is_overridden?: boolean })): string[] {
  if (!a) return [];
  const v = a.is_overridden ? a.value : a.default_value;
  return Array.isArray(v) ? (v as string[]) : [];
}

export async function getTenantPrefExtras(ws: WorkspaceSlug, tenant: string, category: string): Promise<TenantPrefExtras> {
  if (!hasWorkspaceKeys(getWorkspace(ws)))
    return { category, digestSchedule: [], digestOverride: [], conditions: [], except: [], include: [], roles: [] };
  const b = await getRawTenantPref(ws, tenant, category);
  const attrs = b.properties ?? b.condition_attributes ?? [];
  const conditions: Condition[] = attrs
    .filter((a) => a.key === "cost" && a.value_type === "integer")
    .map((a) => ({
      key: a.key,
      label: a.label ?? a.key,
      value: Number((a.is_overridden ? a.value : a.default_value) ?? 0),
      editable: a.edit_policy === "editable",
    }));
  const except = effectiveList(attrs.find((a) => a.key === "except"));
  const include = effectiveList(attrs.find((a) => a.key === "include"));
  const roles = effectiveList(attrs.find((a) => a.key === "role"));
  return {
    category,
    digestSchedule: ssScheduleToDigest({ enabled: true, options: b.digest_schedule?.original_options ?? [] }),
    digestOverride: ssScheduleToDigest({ enabled: true, options: b.digest_schedule?.options ?? [] }),
    conditions,
    except,
    include,
    roles,
  };
}

/** Override the project's recipient roles (the `role` condition attribute). Preserves
 * any except/cost overrides. */
export async function saveTenantRoles(
  ws: WorkspaceSlug,
  tenant: string,
  category: string,
  roles: string[],
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const b = await getRawTenantPref(ws, tenant, category);
  const preserved = (b.properties ?? b.condition_attributes ?? [])
    .filter((a) => a.is_overridden && a.key !== "role")
    .map((a) => ({ key: a.key, value: a.value }));
  const url = prefUrl(tenant, category);
  const body = JSON.stringify({ properties: [...preserved, { key: "role", value: roles }] });
  const res = await fetch(url, { method: "PATCH", headers: signedHeaders(ws, url, "PATCH", body), body });
  return { ok: res.ok, status: res.status };
}

/** Override the project's excluded people (distinct_ids) for a category. Preserves
 * any role/cost overrides; empty list clears the except override. */
export async function saveTenantExcept(
  ws: WorkspaceSlug,
  tenant: string,
  category: string,
  distinctIds: string[],
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const b = await getRawTenantPref(ws, tenant, category);
  const preserved = (b.properties ?? b.condition_attributes ?? [])
    .filter((a) => a.is_overridden && a.key !== "except")
    .map((a) => ({ key: a.key, value: a.value }));
  const url = prefUrl(tenant, category);
  const body = JSON.stringify({ properties: [...preserved, { key: "except", value: distinctIds }] });
  const res = await fetch(url, { method: "PATCH", headers: signedHeaders(ws, url, "PATCH", body), body });
  return { ok: res.ok, status: res.status };
}

/** Override the project's always-notify people (distinct_ids) for a category — the
 * `include` condition attribute (inverse of except). Preserves any role/except/cost
 * overrides; empty list clears the include override. */
export async function saveTenantInclude(
  ws: WorkspaceSlug,
  tenant: string,
  category: string,
  distinctIds: string[],
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const b = await getRawTenantPref(ws, tenant, category);
  const preserved = (b.properties ?? b.condition_attributes ?? [])
    .filter((a) => a.is_overridden && a.key !== "include")
    .map((a) => ({ key: a.key, value: a.value }));
  const url = prefUrl(tenant, category);
  const body = JSON.stringify({ properties: [...preserved, { key: "include", value: distinctIds }] });
  const res = await fetch(url, { method: "PATCH", headers: signedHeaders(ws, url, "PATCH", body), body });
  return { ok: res.ok, status: res.status };
}

/** Override (or, with `option: null`, inherit) the tenant's digest default. */
export async function saveTenantDigest(
  ws: WorkspaceSlug,
  tenant: string,
  category: string,
  option: DigestOption | null,
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const url = prefUrl(tenant, category);
  const options = option ? [{ ...digestToSsOption(option), is_default: true }] : [];
  const body = JSON.stringify({ digest_schedule: { options } });
  const res = await fetch(url, { method: "PATCH", headers: signedHeaders(ws, url, "PATCH", body), body });
  return { ok: res.ok, status: res.status };
}

/** Override the tenant's condition values (cost). Preserves any other overrides
 * (role/except) the tenant already has; empty `conditions` clears the cost override. */
export async function saveTenantConditions(
  ws: WorkspaceSlug,
  tenant: string,
  category: string,
  conditions: Condition[],
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const b = await getRawTenantPref(ws, tenant, category);
  const preserved = (b.properties ?? b.condition_attributes ?? [])
    .filter((a) => a.is_overridden && a.key !== "cost")
    .map((a) => ({ key: a.key, value: a.value }));
  const cost = conditions.filter((c) => c.key === "cost").map((c) => ({ key: c.key, value: c.value }));
  const url = prefUrl(tenant, category);
  const body = JSON.stringify({ properties: [...preserved, ...cost] });
  const res = await fetch(url, { method: "PATCH", headers: signedHeaders(ws, url, "PATCH", body), body });
  return { ok: res.ok, status: res.status };
}

// ── User / object level (the subscriber's own override) ───────────────────────
// The user endpoint is a COMBINED surface: digest_schedule_options (allowed) +
// digest_schedule (a SINGLE resolved pick, is_user_selected) + preference + the
// condition values. Verified PATCH: { preference, digest_schedule: pick | null }
// and { preference, condition_attributes: [...] } (preference is REQUIRED).
const userPrefUrl = (distinctId: string, category: string, tenant?: string) =>
  // SuprSend scopes the user preference to a brand via `tenant_id` (NOT `tenant`).
  // An unrecognised param is treated as "not passed" → it silently writes to the
  // DEFAULT tenant, so the wrong name here landed every per-project digest/condition
  // override on `default`. Must match the v2/subscriber path's `tenant_id`.
  `${HUB}/v1/user/${encodeURIComponent(distinctId)}/preference/category/${encodeURIComponent(category)}/${tenant ? `?tenant_id=${encodeURIComponent(tenant)}` : ""}`;

interface RawUserPref {
  preference?: Pref | null;
  digest_schedule_options?: { options?: SsDigestOption[] } | null;
  digest_schedule?: SsUserPick | null;
  condition_attributes?: RawAttr[] | null;
  properties?: RawAttr[] | null;
}

export interface UserPrefExtras {
  category: string;
  digestSchedule: DigestOption[]; // allowed cadence set
  digestChoice: DigestChoice; // the user's pick (empty = inherit)
  preference: Pref; // current preference — required on every PATCH
  conditions: Condition[]; // effective cost (override value if set, else default)
}

export async function getUserPrefExtras(
  ws: WorkspaceSlug,
  distinctId: string,
  category: string,
  tenant?: string,
): Promise<UserPrefExtras> {
  const base = { category, digestSchedule: [], digestChoice: {}, preference: "opt_in" as Pref, conditions: [] };
  if (!hasWorkspaceKeys(getWorkspace(ws))) return base;
  const url = userPrefUrl(distinctId, category, tenant);
  const res = await fetch(url, { headers: signedHeaders(ws, url, "GET"), cache: "no-store" });
  if (!res.ok) throw new Error(`user preference read failed (${res.status})`);
  const b = (await res.json()) as RawUserPref;
  const conditions: Condition[] = (b.properties ?? b.condition_attributes ?? [])
    .filter((a) => a.key === "cost" && a.value_type === "integer")
    .map((a) => ({
      key: a.key,
      label: a.label ?? a.key,
      value: Number((a.is_overridden ? a.value : a.default_value) ?? 0),
      editable: a.edit_policy === "editable",
    }));
  return {
    category,
    digestSchedule: ssScheduleToDigest({ enabled: true, options: b.digest_schedule_options?.options ?? [] }),
    digestChoice: b.digest_schedule?.is_user_selected ? userPickToChoice(b.digest_schedule) : {},
    preference: b.preference ?? "opt_in",
    conditions,
  };
}

export async function saveUserDigest(
  ws: WorkspaceSlug,
  distinctId: string,
  category: string,
  option: DigestOption | null,
  preference: Pref,
  tenant?: string,
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const url = userPrefUrl(distinctId, category, tenant);
  const body = JSON.stringify({ preference, digest_schedule: option ? digestToUserPick(option) : null });
  const res = await fetch(url, { method: "PATCH", headers: signedHeaders(ws, url, "PATCH", body), body });
  return { ok: res.ok, status: res.status };
}

export async function saveUserConditions(
  ws: WorkspaceSlug,
  distinctId: string,
  category: string,
  conditions: Condition[],
  preference: Pref,
  tenant?: string,
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const cost = conditions.filter((c) => c.key === "cost").map((c) => ({ key: c.key, value: c.value }));
  const url = userPrefUrl(distinctId, category, tenant);
  const body = JSON.stringify({ preference, properties: cost });
  const res = await fetch(url, { method: "PATCH", headers: signedHeaders(ws, url, "PATCH", body), body });
  return { ok: res.ok, status: res.status };
}
