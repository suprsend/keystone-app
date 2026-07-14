// Server-side resolvers for the active workspace (customer) and tenant (project).
// Server Components and API routes read them here so there is ONE source of truth.
// The Management API uses one account-level Service Token; the workspace is
// selected by URL path. This helper builds those paths and the per-workspace SDK.
import "server-only";
import { cookies } from "next/headers";
import { Suprsend } from "@suprsend/node-sdk";
import { DEFAULT_WORKSPACE, getWorkspace, isWorkspaceSlug, type Workspace } from "@/lib/workspaces";
import { getDefaultTenant, type TenantId } from "@/lib/tenants";

/** The active customer workspace (from the `ws` cookie). */
export async function getActiveWorkspace(): Promise<Workspace> {
  const slug = (await cookies()).get("ws")?.value;
  return getWorkspace(isWorkspaceSlug(slug) ? slug : DEFAULT_WORKSPACE);
}

/**
 * The active project (tenant) INSIDE the active workspace. Drives brand, template
 * variants, the inbox feed, triggers, and per-user preferences. The tenant
 * switcher writes the `tenant` cookie; we validate it belongs to the active
 * workspace and otherwise fall back to that workspace's first project. A request
 * may override via `?tenant=` (token routes called before the cookie is set).
 */
export async function getActiveTenant(override?: string | null): Promise<TenantId> {
  const ws = await getActiveWorkspace();
  // Seeded projects live in the static registry; newly-created ones don't, so a
  // present override/cookie is trusted as-is (the UI only sets a tenant for the
  // active workspace, and resets it on workspace switch). Empty → workspace default.
  if (override) return override as TenantId;
  const t = (await cookies()).get("tenant")?.value;
  if (t) return t as TenantId;
  return getDefaultTenant(ws.slug).id;
}

/** Env-var prefix for a workspace's server credentials. slug "wellspring-honeywell" → "SUPRSEND_WELLSPRING_HONEYWELL". */
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
  const signingKeyId = process.env[`${prefix}_SIGNING_KEY_ID`];
  const signingKeyB64 = process.env[`${prefix}_SIGNING_KEY_B64`];
  if (!workspaceKey || !signingKeyId || !signingKeyB64) {
    throw new Error(`Missing signing-key env for ${ws.slug}`);
  }
  return { workspaceKey, signingKeyId, signingKeyB64 };
}
