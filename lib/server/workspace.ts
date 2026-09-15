// Server-side resolvers for the active workspace (customer) and tenant (project).
// Server Components and API routes read them here so there is ONE source of truth.
// The Management API uses one account-level Service Token; the workspace is
// selected by URL path. This helper builds those paths and the per-workspace SDK.
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { Suprsend } from "@suprsend/node-sdk";
import { workspaceKeysFromEnv, type Workspace, type WorkspaceInfo } from "@/lib/workspaces";

const MGMNT = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com").replace(/\/$/, "");

/**
 * The workspaces this app can use: every workspace in the SuprSend account whose
 * Workspace Key (= the workspace UID) is in the env. The name comes from the account's
 * workspace list; the logo and colour from the workspace's `default` tenant (Administer
 * → Brand). Workspaces without keys are left out — the app can't call them. Sorted by
 * slug, memoized per request.
 */
export const listWorkspaces = cache(async (): Promise<WorkspaceInfo[]> => {
  const configured = workspaceKeysFromEnv(process.env);
  const token = process.env.SUPRSEND_SERVICE_TOKEN;
  if (configured.length === 0) return [];
  if (!token) throw new Error("SUPRSEND_SERVICE_TOKEN is not set");
  const res = await fetch(`${MGMNT}/v1/workspace/?limit=100`, {
    headers: { Authorization: `ServiceToken ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Couldn't list SuprSend workspaces (${res.status})`);
  const body = (await res.json()) as { results?: { uid: string; name: string }[] };
  const inAccount = configured.flatMap((c) => {
    const w = (body.results ?? []).find((r) => r.uid === c.key);
    return w ? [{ slug: c.slug, label: w.name }] : [];
  });
  return Promise.all(
    inAccount.map(async (w) => {
      const brand = hasWorkspaceKeys(w)
        ? ((await suprsendClient(w).tenants.get("default").catch(() => null)) as { logo?: string; primary_color?: string } | null)
        : null;
      return { ...w, logo: brand?.logo ?? "", accent: brand?.primary_color ?? "" };
    }),
  );
});

/**
 * The active customer workspace: the `ws` cookie when it names a workspace with keys,
 * else the first one. Reads the env only (no network) so every API route stays fast;
 * the layouts check the workspace actually exists in the account (WorkspaceGuard).
 */
export async function getActiveWorkspace(): Promise<Workspace> {
  const slug = (await cookies()).get("ws")?.value;
  const configured = workspaceKeysFromEnv(process.env);
  const ws = configured.find((w) => w.slug === slug) ?? configured[0];
  if (!ws) throw new Error("No SuprSend workspace connected — add a workspace's keys to .env.local.");
  return { slug: ws.slug };
}

/**
 * The active project (tenant) INSIDE the active workspace. Drives brand, template
 * variants, the inbox feed, triggers, and per-user preferences. A request may pass
 * `?tenant=` (token routes called before the cookie is set); otherwise the `tenant`
 * cookie, which the client keeps pointed at a project that exists. "" when the
 * workspace has no projects yet.
 */
export async function getActiveTenant(override?: string | null): Promise<string> {
  if (override) return override;
  return (await cookies()).get("tenant")?.value ?? "";
}

/** Env-var prefix for a workspace's server credentials. slug "acme" → "SUPRSEND_ACME". */
export function envPrefix(ws: Workspace): string {
  return `SUPRSEND_${ws.slug.replace(/-/g, "_").toUpperCase()}`;
}

/** Env-var prefix for a workspace's public (browser-exposed) credentials. */
export function publicEnvPrefix(ws: Workspace): string {
  return `NEXT_PUBLIC_SUPRSEND_${ws.slug.replace(/-/g, "_").toUpperCase()}`;
}

/** True when this workspace has its SuprSend keys configured (else reads return empty / honest "unconfigured" states). */
export function hasWorkspaceKeys(ws: Workspace): boolean {
  const prefix = envPrefix(ws);
  return Boolean(process.env[`${prefix}_WORKSPACE_KEY`] && process.env[`${prefix}_WORKSPACE_SECRET`]);
}

/** Node-SDK client for a workspace (hub.suprsend.com) — key + secret from env. */
export function suprsendClient(ws: Workspace) {
  const prefix = envPrefix(ws);
  const key = process.env[`${prefix}_WORKSPACE_KEY`];
  const secret = process.env[`${prefix}_WORKSPACE_SECRET`];
  if (!key || !secret) throw new Error(`Missing workspace key/secret for ${ws.slug}`);
  // No host override — the SDK uses its production default (hub.suprsend.com).
  return new Suprsend(key, secret);
}

export interface WorkspaceSecrets {
  workspaceKey: string;
  signingKeyId: string;
  signingKeyB64: string;
}

/** Per-workspace secrets (workspace key + signing key) for the embedded editor JWT. */
export function getWorkspaceSecrets(ws: Workspace): WorkspaceSecrets {
  const prefix = envPrefix(ws);
  const workspaceKey = process.env[`${prefix}_WORKSPACE_KEY`];
  const signingKeyId = process.env[`${prefix}_SIGNING_KEY_UID`];
  const signingKeyB64 = process.env[`${prefix}_SIGNING_KEY_B64`];
  if (!workspaceKey || !signingKeyId || !signingKeyB64) {
    throw new Error(`Missing signing-key env for ${ws.slug}`);
  }
  return { workspaceKey, signingKeyId, signingKeyB64 };
}
