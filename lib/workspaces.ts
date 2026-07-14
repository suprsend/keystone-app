// Workspace registry — one workspace per CUSTOMER (the companies that run
// Keystone). This is Keystone's model: each customer is its own isolated SuprSend
// workspace with its own keys. The account-level Service Token selects the
// workspace by URL path on the Management API; the per-workspace key/secret +
// signing key drive the node SDK and the embedded editor.
//
// Projects live INSIDE a workspace as tenants — see lib/tenants.ts. The app
// switches BOTH the workspace (customer) and the tenant (project).
//
// To add a customer: add an entry here, add the matching env vars (prefix =
// `envPrefix(ws)` in lib/server/workspace.ts), and add its projects in
// lib/tenants.ts. Brand colour/logo here is the render-time default.

export type WorkspaceSlug = "acme" | "globex";

export interface Workspace {
  slug: WorkspaceSlug;
  /** Short customer name shown in the switcher. */
  label: string;
  /** Full legal name for headers / empty states. */
  fullName: string;
  /** Single-letter mark for the avatar tile (fallback when the logo can't load). */
  initial: string;
  /** Customer logo (served from /public/brands). */
  logo: string;
  /** Customer brand accent — the workspace-level identity colour. */
  accent: string;
  /** Foreground that reads on the accent. */
  accentForeground: string;
}

export const WORKSPACES: Workspace[] = [
  {
    slug: "acme",
    label: "Acme",
    fullName: "Acme Corporation",
    initial: "Ac",
    logo: "/brands/acme.svg",
    accent: "#2563EB",
    accentForeground: "#ffffff",
  },
  {
    slug: "globex",
    label: "Globex",
    fullName: "Globex Corporation",
    initial: "Gx",
    logo: "/brands/globex.svg",
    accent: "#0F766E",
    accentForeground: "#ffffff",
  },
];

export const DEFAULT_WORKSPACE: WorkspaceSlug = "acme";

export function getWorkspace(slug?: string | null): Workspace {
  return WORKSPACES.find((w) => w.slug === slug) ?? WORKSPACES[0];
}

export function isWorkspaceSlug(value?: string | null): value is WorkspaceSlug {
  return WORKSPACES.some((w) => w.slug === value);
}
