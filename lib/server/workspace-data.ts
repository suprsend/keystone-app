// Per-project roster accessor (backed by a lazily-seeded in-memory store).
//
// Sample seed data — a real deployment reads people from its own DB. This exposes
// the demo project's membership (people + the project manager) to the live paths
// that need it: /api/trigger (whole-project fan-out + the current PM's name) and
// /api/users (member ids). It is seeded from lib/people.ts (the shared roster seed).
//
// Scope: keyed by project (tenant). Module-level singleton on globalThis so it
// survives dev hot-reloads.
//
// EMAIL SAFETY: recipients are roster people whose emails are already
// plus-addressed to the one inbox we control (lib/people.ts).
import "server-only";
import type { TenantId } from "@/lib/tenants";
import { getRoster, getProjectManager, type PersonRole } from "@/lib/people";

// ── State ─────────────────────────────────────────────────────────────────────
interface PersonRow { id: string; name: string; role: PersonRole; email: string }
interface ProjectState {
  pmId: string;
  people: PersonRow[];
}

function seed(tenant: TenantId): ProjectState {
  const roster = getRoster(tenant);
  const people: PersonRow[] = roster.map((p) => ({ id: p.id, name: p.name, role: p.role, email: p.email }));
  return {
    pmId: getProjectManager(tenant)?.id ?? people[0]?.id ?? "",
    people,
  };
}

const g = globalThis as unknown as { __wsData?: Record<string, ProjectState> };
function store(): Record<string, ProjectState> {
  if (!g.__wsData) g.__wsData = {};
  return g.__wsData;
}
function state(tenant: TenantId): ProjectState {
  const s = store();
  if (!s[tenant]) s[tenant] = seed(tenant);
  return s[tenant];
}
function personOf(st: ProjectState, id: string): PersonRow | undefined {
  return st.people.find((p) => p.id === id);
}

// ── Project membership accessors (the store IS the per-project roster) ──────────
// So the Users tab, "Viewing as", Test-panel roster and role-filtered fan-out all
// agree on who's on each project.
export function getProjectPeople(tenant: TenantId): { id: string; name: string; role: PersonRole; email: string }[] {
  return state(tenant).people.map((p) => ({ id: p.id, name: p.name, role: p.role, email: p.email }));
}
export function getProjectPmName(tenant: TenantId): string {
  const s = state(tenant);
  return personOf(s, s.pmId)?.name ?? "";
}
