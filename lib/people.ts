// People roster per project (tenant). This is the demo's sample org directory: the
// team members, project manager, sponsor and process owner on each Keystone
// project. It is the single source of truth for both the notification
// subscription surfaces and the /api/users roster, so they stay consistent.
//
// Sample seed data — a real deployment reads people from its own DB and syncs them
// to SuprSend via the script. The ids/names/roles live in lib/roster-seed.json
// (shared with scripts/provision.mjs so the app and provisioning never diverge);
// emails are derived here from the name.
//
// EMAIL SAFETY — READ THIS:
// Every address MUST route to the one safe inbox so notifications are testable but
// reach NO ONE else. NEVER use a real company domain (acme.com, globexs.com) or
// a bare name@domain — those can hit real people. The safe inbox is configurable; the
// policy lives in lib/safe-email.ts (SAFE_TEST_EMAIL_USER / _DOMAIN).

import type { TenantId } from "@/lib/tenants";
import { testEmail } from "@/lib/safe-email";
import rosterSeed from "@/lib/roster-seed.json";

export type PersonRole = "Project Manager" | "Team Member" | "Project Sponsor" | "Process Owner";

export interface Person {
  id: string;
  name: string;
  email: string;
  role: PersonRole;
}

// All demo mail goes to ONE safe inbox via plus-addressing (see lib/safe-email.ts).
const mail = testEmail;

// Safe local-part derived from the name (e.g. "Dana Carter" → "dana.carter"),
// matching the derivation in scripts/provision.mjs so both produce identical emails.
const localFromName = (name: string) => name.toLowerCase().replace(/\s+/g, ".");

// The shared seed carries only ids/names/roles (JSON widens role to string).
interface SeedPerson { id: string; name: string; role: PersonRole }
const SEED = rosterSeed.roster as unknown as Record<TenantId, SeedPerson[]>;

// NAMES: US/English only — our customers are US-based (see roster-seed.json).
// Build the runtime roster by attaching each person's safe plus-addressed email.
export const ROSTER: Record<TenantId, Person[]> = Object.fromEntries(
  Object.entries(SEED).map(([tenant, people]) => [
    tenant,
    people.map((p) => ({ id: p.id, name: p.name, email: mail(localFromName(p.name)), role: p.role })),
  ]),
) as Record<TenantId, Person[]>;

export function getRoster(tenant: TenantId): Person[] {
  return ROSTER[tenant] ?? [];
}

/** The project manager of a project (first PM in the roster). */
export function getProjectManager(tenant: TenantId): Person | undefined {
  return getRoster(tenant).find((p) => p.role === "Project Manager");
}

export function getPerson(tenant: TenantId, id: string): Person | undefined {
  return getRoster(tenant).find((p) => p.id === id);
}

const PALETTE = ["#0072CE", "#C8102E", "#7C3AED", "#ED7902", "#0A8080", "#B45309"];

/** Stable avatar colour for a person id. */
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
