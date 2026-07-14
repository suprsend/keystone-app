// Brand Settings — read/edit the workspace's SuprSend tenant brand (the `default`
// tenant that carries each customer's logo, colours and links, auto-injected into
// templates as {{$brand.*}}). Backed by the node SDK tenants.get / tenants.upsert.
import "server-only";
import type { Workspace } from "@/lib/workspaces";
import { suprsendClient as client, hasWorkspaceKeys } from "@/lib/server/workspace";
import type { TenantId } from "@/lib/tenants";

// The social links we surface for editing (the tenant stores more keys; we merge
// onto the full set on save so untouched ones are preserved).
export const SOCIAL_KEYS = ["website", "linkedin", "twitter", "facebook", "instagram"] as const;

export interface Brand {
  tenantName: string;
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
  socialLinks: Record<string, string>;
  /** Custom tenant properties — free-form key/value pairs on the tenant. */
  properties: Record<string, string>;
}

interface RawTenant {
  tenant_name?: string;
  logo?: string;
  primary_color?: string;
  secondary_color?: string;
  tertiary_color?: string;
  social_links?: Record<string, string>;
  properties?: Record<string, unknown>;
}

export async function getBrand(ws: Workspace, tenantId: string): Promise<Brand> {
  if (!hasWorkspaceKeys(ws)) return { tenantName: "", logo: "", primaryColor: "", secondaryColor: "", tertiaryColor: "", socialLinks: {}, properties: {} };
  const t = (await client(ws).tenants.get(tenantId)) as RawTenant;
  const sl = t.social_links ?? {};
  const socialLinks: Record<string, string> = {};
  for (const k of SOCIAL_KEYS) socialLinks[k] = sl[k] ?? "";
  // Surface only meaningful properties — SuprSend can't truly delete a tenant
  // property, so "removed" ones are stored as null; hide those (and empties).
  const properties: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.properties ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    properties[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return {
    tenantName: t.tenant_name ?? "",
    logo: t.logo ?? "",
    primaryColor: t.primary_color ?? "",
    secondaryColor: t.secondary_color ?? "",
    tertiaryColor: t.tertiary_color ?? "",
    socialLinks,
    properties,
  };
}

export async function updateBrand(ws: Workspace, tenantId: string, b: Brand) {
  const c = client(ws);
  // Preserve social-link keys we don't expose (merge onto the live set).
  const existing = (await c.tenants.get(tenantId)) as RawTenant;
  const social_links = { ...(existing.social_links ?? {}), ...b.socialLinks };
  // Custom properties: keep the admin's current set, and null-out any key that was
  // removed (SuprSend merges on upsert + can't hard-delete, so null = "cleared";
  // getBrand then hides null values, so it reads as deleted).
  const properties: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(b.properties ?? {})) {
    if (k.trim()) properties[k.trim()] = v;
  }
  const existingProps = (existing.properties ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(existingProps)) {
    if (!(k in properties)) properties[k] = null;
  }
  return c.tenants.upsert(tenantId, {
    tenant_name: b.tenantName,
    logo: b.logo,
    primary_color: b.primaryColor,
    secondary_color: b.secondaryColor,
    tertiary_color: b.tertiaryColor,
    social_links,
    properties,
  });
}
