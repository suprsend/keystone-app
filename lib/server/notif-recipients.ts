// LIVE recipient-type + category resolution. Recipient roles for each notification
// are stored on its SuprSend workflow as `recip:<role-slug>` tags — so admins can
// add/remove recipient types (Task 6) and those edits persist on the live workflow
// and drive both role-filtered fan-out and role-based category visibility (Task 5).
//
// One management-API call (workflow list, mode=live) returns every workflow's tags,
// category and tree, so the whole map is built in a single request. A tag's slug is
// matched to a role name from the workspace's live role options (getRoleOptions).
import "server-only";
import type { WorkspaceSlug } from "@/lib/workspaces";
import { getWorkspace } from "@/lib/workspaces";
import { hasWorkspaceKeys, envPrefix } from "@/lib/server/workspace";
import { getRoleOptions } from "@/lib/server/preference-config";
import { getWorkflow, publishWorkflow } from "@/lib/suprsend-mgmt";

const MGMNT = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com/").replace(/\/$/, "");
const RECIP_PREFIX = "recip:";
// Specific-user recipients (raw emails). Stored as lowercase HEX — SuprSend
// normalizes tags (lowercases / strips punctuation), so base64 wouldn't survive;
// hex is [0-9a-f] only and round-trips cleanly. (Email's @ / . / + are encoded.)
const EMAIL_PREFIX = "recipuser:";
const encEmail = (e: string): string => Buffer.from(e, "utf8").toString("hex");
const decEmail = (s: string): string => {
  try {
    const d = Buffer.from(s, "hex").toString("utf8");
    return /.+@.+/.test(d) ? d : "";
  } catch {
    return "";
  }
};
const tagsToEmails = (tags: string[]): string[] =>
  tags.filter((t) => t.startsWith(EMAIL_PREFIX)).map((t) => decEmail(t.slice(EMAIL_PREFIX.length))).filter(Boolean);
const emailsToTags = (emails: string[]): string[] => emails.map((e) => `${EMAIL_PREFIX}${encEmail(e)}`);

export const roleToSlug = (r: string): string => r.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const rolesBySlug = (roleOptions: string[]): Record<string, string> =>
  Object.fromEntries(roleOptions.map((r) => [roleToSlug(r), r]));
const tagsToRoles = (tags: string[], bySlug: Record<string, string>): string[] =>
  tags.filter((t) => t.startsWith(RECIP_PREFIX)).map((t) => bySlug[t.slice(RECIP_PREFIX.length)]).filter(Boolean);
// `recip:` tags whose slug isn't one of the workspace's role options — e.g. added on
// a workflow in the SuprSend dashboard. Shown read-only (title-cased from the slug)
// rather than silently dropped.
const tagsToExtraRoles = (tags: string[], bySlug: Record<string, string>): string[] =>
  tags
    .filter((t) => t.startsWith(RECIP_PREFIX) && !bySlug[t.slice(RECIP_PREFIX.length)])
    .map((t) =>
      t
        .slice(RECIP_PREFIX.length)
        .split("-")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
    );
const rolesToTags = (roles: string[]): string[] => roles.map((r) => `${RECIP_PREFIX}${roleToSlug(r)}`);

// Every template slug a workflow's tree sends (its send nodes' `template` fields).
function templateSlugs(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const n of node) templateSlugs(n, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "template" && typeof v === "string") out.add(v);
      else templateSlugs(v, out);
    }
  }
  return out;
}

function authHeaders(): Record<string, string> {
  const token = process.env.SUPRSEND_SERVICE_TOKEN;
  if (!token) throw new Error("SUPRSEND_SERVICE_TOKEN is not set");
  return { Authorization: `ServiceToken ${token}`, "Content-Type": "application/json" };
}
function wsKey(ws: WorkspaceSlug): string {
  return process.env[`${envPrefix(getWorkspace(ws))}_WORKSPACE_KEY`] || ws;
}

export interface NotifConfig {
  /** Workflow slug = live identifier. */
  slug: string;
  /** Preference category slug. */
  category: string;
  /** Templates the workflow sends. */
  templates: string[];
  /** Recipient roles (from live `recip:` tags). */
  roles: string[];
  /** `recip:` tags outside the workspace's role options (dashboard-managed) — display-only. */
  extraRoles: string[];
  /** Specific-user recipients by email (from live `recipuser:` tags). */
  emails: string[];
}

interface LiveWorkflow {
  slug: string;
  category?: string;
  tags?: string[];
  tree?: unknown;
}

/**
 * Live recipient/category config for every workflow in this workspace. Pass
 * `roleOptions` when the caller already has them, to skip a second category read.
 */
export async function getNotifConfig(ws: WorkspaceSlug, roleOptions?: string[]): Promise<NotifConfig[]> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return [];
  const [res, options] = await Promise.all([
    fetch(`${MGMNT}/v1/${wsKey(ws)}/workflow/?mode=live&limit=100`, { headers: authHeaders(), cache: "no-store" }),
    roleOptions ?? getRoleOptions(ws),
  ]);
  if (!res.ok) throw new Error(`workflow list failed (${res.status})`);
  const body = (await res.json()) as { results?: LiveWorkflow[] };
  const bySlug = rolesBySlug(options);
  return (body.results ?? []).map((w) => ({
    slug: w.slug,
    category: w.category ?? "",
    templates: [...templateSlugs(w.tree)],
    roles: tagsToRoles(w.tags ?? [], bySlug),
    extraRoles: tagsToExtraRoles(w.tags ?? [], bySlug),
    emails: tagsToEmails(w.tags ?? []),
  }));
}

/**
 * Replace a workflow's recipient roles (its `recip:` tags), preserving every other
 * tag and the whole tree. Re-commits the live workflow — the same fetch→edit→
 * republish pattern as the Active toggle.
 */
export async function setWorkflowRecipients(
  ws: WorkspaceSlug,
  slug: string,
  roles: string[],
  emails: string[] = [],
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const [wf, options] = await Promise.all([getWorkflow(ws, slug), getRoleOptions(ws)]);
  if (!wf.ok || !wf.body || typeof wf.body !== "object") return { ok: false, status: 404 };
  const bySlug = rolesBySlug(options);
  const body = wf.body as Record<string, unknown>;
  const existing = (body.tags as string[] | undefined) ?? [];
  // Drop old recipient tags (roles + emails), keep everything else, re-add both.
  // `recip:` tags outside the role options are dashboard-managed — the UI can't
  // re-add them, so keep them too instead of destroying them on every save.
  const kept = existing.filter(
    (t) =>
      !t.startsWith(EMAIL_PREFIX) &&
      (!t.startsWith(RECIP_PREFIX) || !bySlug[t.slice(RECIP_PREFIX.length)]),
  );
  body.tags = [...kept, ...rolesToTags(roles), ...emailsToTags(emails)];
  const r = await publishWorkflow(ws, slug, body);
  return { ok: r.ok, status: r.status };
}
