// LIVE recipient-type + category resolution. Recipient roles for each notification
// are stored on its SuprSend workflow as `recip:<role-slug>` tags — so admins can
// add/remove recipient types (Task 6) and those edits persist on the live workflow
// and drive both role-filtered fan-out and role-based category visibility (Task 5).
//
// One management-API call (workflow list, mode=live) returns every workflow's tags
// + category, so the whole map is built in a single request. Falls back to the
// static catalog (lib/notifications) when a workspace has no SuprSend keys.
import "server-only";
import type { WorkspaceSlug } from "@/lib/workspaces";
import { getWorkspace } from "@/lib/workspaces";
import { hasWorkspaceKeys, envPrefix } from "@/lib/server/workspace";
import type { PersonRole } from "@/lib/people";
import { getNotifications, categorySlugOf, ROLE_OPTIONS } from "@/lib/notifications";
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

export const roleToSlug = (r: PersonRole): string => r.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const ROLE_BY_SLUG: Record<string, PersonRole> = Object.fromEntries(ROLE_OPTIONS.map((r) => [roleToSlug(r), r]));
const tagsToRoles = (tags: string[]): PersonRole[] =>
  tags.filter((t) => t.startsWith(RECIP_PREFIX)).map((t) => ROLE_BY_SLUG[t.slice(RECIP_PREFIX.length)]).filter(Boolean) as PersonRole[];
const rolesToTags = (roles: PersonRole[]): string[] => roles.map((r) => `${RECIP_PREFIX}${roleToSlug(r)}`);

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
  /** Preference category slug (name-derived). */
  category: string;
  /** Recipient roles (from live `recip:` tags, or the static default). */
  roles: PersonRole[];
  /** Specific-user recipients by email (from live `recipuser:` tags). */
  emails: string[];
}

interface LiveWorkflow {
  slug: string;
  category?: string;
  tags?: string[];
}

/**
 * Live recipient/category config for every notification in this workspace. Reads
 * the workflows' `recip:` tags; for workspaces without keys, derives from the
 * static catalog so the UI still renders.
 */
export async function getNotifConfig(ws: WorkspaceSlug): Promise<NotifConfig[]> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) {
    return getNotifications(ws).map((n) => ({
      slug: n.id,
      category: categorySlugOf(n.name),
      roles: n.recipients,
      emails: [],
    }));
  }
  const res = await fetch(`${MGMNT}/v1/${wsKey(ws)}/workflow/?mode=live&limit=100`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`workflow list failed (${res.status})`);
  const body = (await res.json()) as { results?: LiveWorkflow[] };
  return (body.results ?? []).map((w) => ({
    slug: w.slug,
    category: w.category ?? "",
    roles: tagsToRoles(w.tags ?? []),
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
  roles: PersonRole[],
  emails: string[] = [],
): Promise<{ ok: boolean; status: number }> {
  if (!hasWorkspaceKeys(getWorkspace(ws))) return { ok: true, status: 200 };
  const wf = await getWorkflow(ws, slug);
  if (!wf.ok || !wf.body || typeof wf.body !== "object") return { ok: false, status: 404 };
  const body = wf.body as Record<string, unknown>;
  const existing = (body.tags as string[] | undefined) ?? [];
  // Drop old recipient tags (roles + emails), keep everything else, re-add both.
  const kept = existing.filter((t) => !t.startsWith(RECIP_PREFIX) && !t.startsWith(EMAIL_PREFIX));
  body.tags = [...kept, ...rolesToTags(roles), ...emailsToTags(emails)];
  const r = await publishWorkflow(ws, slug, body);
  return { ok: r.ok, status: r.status };
}
