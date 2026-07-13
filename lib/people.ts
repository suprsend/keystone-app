// People roster per project (tenant). This is the demo's mock org directory: the
// team members, project manager, sponsor and process owner on each Accolade
// project. It is the single source of truth for both the notification
// subscription surfaces and the mock /api/users roster, so they stay consistent.
//
// EMAIL SAFETY — READ THIS:
// Every address MUST route to the one safe inbox so notifications are testable but
// reach NO ONE else. NEVER use a real company domain (honeywell.com, hersheys.com) or
// a bare name@domain — those can hit real people. The safe inbox is configurable; the
// policy lives in lib/safe-email.ts (SAFE_TEST_EMAIL_USER / _DOMAIN).

import type { TenantId } from "@/lib/tenants";
import { testEmail } from "@/lib/safe-email";

export type PersonRole = "Project Manager" | "Team Member" | "Project Sponsor" | "Process Owner";

export interface Person {
  id: string;
  name: string;
  email: string;
  role: PersonRole;
}

// All demo mail goes to ONE safe inbox via plus-addressing (see lib/safe-email.ts).
const mail = testEmail;

// NAMES: US/English only — our customers are US-based. Keep every name a common
// American name (no non-US names). Emails stay plus-addressed to the one safe inbox.
export const ROSTER: Record<TenantId, Person[]> = {
  "honeywell-aero": [
    { id: "u_dana_carter", name: "Dana Carter", email: mail("dana.carter"), role: "Project Manager" },
    { id: "u_marcus_hale", name: "Marcus Hale", email: mail("marcus.hale"), role: "Project Sponsor" },
    { id: "u_karen_brooks", name: "Karen Brooks", email: mail("karen.brooks"), role: "Process Owner" },
    { id: "u_evan_cole", name: "Evan Cole", email: mail("evan.cole"), role: "Team Member" },
    { id: "u_sarah_bennett", name: "Sarah Bennett", email: mail("sarah.bennett"), role: "Team Member" },
    { id: "u_luke_harper", name: "Luke Harper", email: mail("luke.harper"), role: "Team Member" },
  ],
  "honeywell-bms": [
    { id: "u_grace_miller", name: "Grace Miller", email: mail("grace.miller"), role: "Project Manager" },
    { id: "u_tom_freed", name: "Tom Freed", email: mail("tom.freed"), role: "Project Sponsor" },
    { id: "u_nancy_reed", name: "Nancy Reed", email: mail("nancy.reed"), role: "Process Owner" },
    { id: "u_ben_stark", name: "Ben Stark", email: mail("ben.stark"), role: "Team Member" },
    { id: "u_mia_foster", name: "Mia Foster", email: mail("mia.foster"), role: "Team Member" },
    { id: "u_owen_daniels", name: "Owen Daniels", email: mail("owen.daniels"), role: "Team Member" },
  ],
  "hsy-reeses": [
    { id: "u_riley_fox", name: "Riley Fox", email: mail("riley.fox"), role: "Project Manager" },
    { id: "u_dale_burns", name: "Dale Burns", email: mail("dale.burns"), role: "Project Sponsor" },
    { id: "u_amy_sullivan", name: "Amy Sullivan", email: mail("amy.sullivan"), role: "Process Owner" },
    { id: "u_carl_hayes", name: "Carl Hayes", email: mail("carl.hayes"), role: "Team Member" },
    { id: "u_jade_morgan", name: "Jade Morgan", email: mail("jade.morgan"), role: "Team Member" },
    { id: "u_paul_nash", name: "Paul Nash", email: mail("paul.nash"), role: "Team Member" },
  ],
  "hsy-kisses": [
    { id: "u_iris_lane", name: "Iris Lane", email: mail("iris.lane"), role: "Project Manager" },
    { id: "u_greg_pope", name: "Greg Pope", email: mail("greg.pope"), role: "Project Sponsor" },
    { id: "u_laura_west", name: "Laura West", email: mail("laura.west"), role: "Process Owner" },
    { id: "u_zach_allen", name: "Zach Allen", email: mail("zach.allen"), role: "Team Member" },
    { id: "u_tara_vance", name: "Tara Vance", email: mail("tara.vance"), role: "Team Member" },
    { id: "u_noah_bishop", name: "Noah Bishop", email: mail("noah.bishop"), role: "Team Member" },
  ],
};

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
