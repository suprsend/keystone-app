// Workspaces — one SuprSend workspace per CUSTOMER (the companies that run Keystone).
// Each customer is its own isolated workspace with its own keys.
//
// Nothing about a workspace is hardcoded. The app shows every workspace in the SuprSend
// account whose Workspace Key is in the env (SUPRSEND_<SLUG>_WORKSPACE_KEY), with its
// name read from the Management API and its logo/colour from the workspace's default
// brand — see listWorkspaces() in lib/server/workspace.ts. Projects live INSIDE a
// workspace as tenants and are read live too.

/** The env-var segment that names a workspace: SUPRSEND_ACME_WORKSPACE_KEY → "acme". */
export type WorkspaceSlug = string;

/** Server-side handle for a workspace — enough to find its keys in the env. */
export interface Workspace {
  slug: WorkspaceSlug;
}

/** What the UI shows for a workspace — all read live from SuprSend. */
export interface WorkspaceInfo extends Workspace {
  /** Workspace name in the SuprSend account. */
  label: string;
  /** Logo from the workspace's default brand ("" when unset). */
  logo: string;
  /** Primary colour from the workspace's default brand ("" when unset). */
  accent: string;
}

export function getWorkspace(slug: WorkspaceSlug): Workspace {
  return { slug };
}

/** Every workspace with a Workspace Key set in the env, sorted by slug. */
export function workspaceKeysFromEnv(env: Record<string, string | undefined>): { slug: WorkspaceSlug; key: string }[] {
  const out: { slug: WorkspaceSlug; key: string }[] = [];
  for (const [name, value] of Object.entries(env)) {
    const m = /^SUPRSEND_([A-Z0-9_]+)_WORKSPACE_KEY$/.exec(name);
    if (m && value) out.push({ slug: m[1].toLowerCase().replace(/_/g, "-"), key: value });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}
