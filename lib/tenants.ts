// Tenant registry — the PROJECTS that live inside each customer's workspace.
// In this app a PROJECT IS A TENANT: each project is a SuprSend tenant (its own
// brand/colours, template variants, tenant-scoped preferences, inbox feed, and
// triggers via `tenant_id`). The Projects surface is driven directly by this
// registry — add a tenant here (and create it in SuprSend) and it shows up.
//
// The NPD attributes (stage/health/npv/nextGate) are project metadata kept
// alongside the tenant so projects = tenants with no separate mock list. The
// project manager is resolved from the people roster (lib/people.ts).

import type { WorkspaceSlug } from "@/lib/workspaces";
import { DEFAULT_WORKSPACE } from "@/lib/workspaces";

export type TenantId =
  | "honeywell-aero"
  | "honeywell-bms"
  | "hsy-reeses"
  | "hsy-kisses";

export type Stage = "Discovery" | "Scoping" | "Business Case" | "Development" | "Testing" | "Launch";
export type Health = "On track" | "At risk" | "Off track";

export const STAGES: Stage[] = ["Discovery", "Scoping", "Business Case", "Development", "Testing", "Launch"];

export interface Tenant {
  id: TenantId;
  /** The customer/workspace this project belongs to. */
  workspace: WorkspaceSlug;
  /** Short project name shown in the switcher. */
  label: string;
  /** Full project name for headers / empty states. */
  fullName: string;
  /** Single-letter mark for the avatar tile (fallback when the logo can't load). */
  initial: string;
  /** Tenant/project logo (the live SuprSend brand logo). Empty → initial tile. */
  logo: string;
  /** Brand accent (per-project brand; shown on switcher tiles + live email/inbox). */
  accent: string;
  /** Foreground that reads on the accent. */
  accentForeground: string;
  // ── NPD project metadata (project = tenant) ────────────────────────────────
  category: string;
  stage: Stage;
  health: Health;
  /** Net present value, in $K. */
  npv: number;
  /** Next stage-gate review date. */
  nextGate: string;
}

export const TENANTS: Tenant[] = [
  // ── Honeywell projects ──────────────────────────────────────────────────────
  {
    id: "honeywell-aero",
    workspace: "wellspring-honeywell",
    label: "Aero Turbine Sensors Gen-2",
    fullName: "Aerospace — Turbine Sensors Generation 2",
    initial: "A",
    logo: "",
    accent: "#0F4C81",
    accentForeground: "#ffffff",
    category: "Aerospace",
    stage: "Development",
    health: "On track",
    npv: 18420,
    nextGate: "Jul 14, 2026",
  },
  {
    id: "honeywell-bms",
    workspace: "wellspring-honeywell",
    label: "Smart Building Controls v4",
    fullName: "Building Technologies — Smart Controls v4",
    initial: "B",
    logo: "",
    accent: "#00857A",
    accentForeground: "#ffffff",
    category: "Building Technologies",
    stage: "Testing",
    health: "At risk",
    npv: 24180,
    nextGate: "Jun 30, 2026",
  },
  // ── Hershey projects ───────────────────────────────────────────────────────
  {
    id: "hsy-reeses",
    workspace: "wellspring-hershey",
    label: "Reese's Zero-Sugar",
    fullName: "Reese's Zero-Sugar Line Extension",
    initial: "R",
    logo: "",
    accent: "#ED7902",
    accentForeground: "#ffffff",
    category: "Confectionery",
    stage: "Development",
    health: "On track",
    npv: 21240,
    nextGate: "Jul 10, 2026",
  },
  {
    id: "hsy-kisses",
    workspace: "wellspring-hershey",
    label: "Hershey Kisses",
    fullName: "Hershey Kisses",
    initial: "HK",
    logo: "",
    accent: "#7C3AED",
    accentForeground: "#ffffff",
    category: "Confectionery",
    stage: "Business Case",
    health: "At risk",
    npv: 15760,
    nextGate: "Aug 14, 2026",
  },
];

/** Projects belonging to a given customer/workspace. */
export function getTenantsForWorkspace(ws?: string | null): Tenant[] {
  const list = TENANTS.filter((t) => t.workspace === ws);
  return list.length ? list : TENANTS.filter((t) => t.workspace === DEFAULT_WORKSPACE);
}

/** The default (first) project for a workspace. */
export function getDefaultTenant(ws?: string | null): Tenant {
  return getTenantsForWorkspace(ws)[0];
}

/** Resolve a tenant by its global id (any workspace), falling back to the first. */
export function getTenant(id?: string | null): Tenant {
  return TENANTS.find((t) => t.id === id) ?? TENANTS[0];
}

export function isTenantId(value?: string | null): value is TenantId {
  return TENANTS.some((t) => t.id === value);
}

/** True when `id` is a valid project of the given workspace. */
export function isTenantOfWorkspace(ws: string | null | undefined, id?: string | null): boolean {
  return TENANTS.some((t) => t.id === id && t.workspace === ws);
}
