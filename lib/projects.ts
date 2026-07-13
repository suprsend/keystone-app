// Projects = tenants. The Projects surface reads the tenant registry directly
// (lib/tenants.ts) so the list is exactly the projects you create as SuprSend
// tenants in each workspace — no separate mock portfolio. The project manager is
// resolved from the people roster.

import { getTenantsForWorkspace, STAGES, type Stage, type Health } from "@/lib/tenants";
import type { TenantId } from "@/lib/tenants";
import { getProjectManager } from "@/lib/people";
import type { WorkspaceSlug } from "@/lib/workspaces";

export { STAGES };
export type { Stage, Health };

export interface Project {
  id: string;
  name: string;
  category: string;
  stage: Stage;
  health: Health;
  manager: string;
  /** Net present value, in $K. */
  npv: number;
  nextGate: string;
  /** Always set — every project is a tenant; links the row to its notifications. */
  tenantId: TenantId;
}

export function getProjects(ws: WorkspaceSlug): Project[] {
  return getTenantsForWorkspace(ws).map((t) => ({
    id: t.id,
    name: t.fullName,
    category: t.category,
    stage: t.stage,
    health: t.health,
    manager: getProjectManager(t.id)?.name ?? "—",
    npv: t.npv,
    nextGate: t.nextGate,
    tenantId: t.id,
  }));
}

export interface PortfolioSummary {
  total: number;
  inDevelopment: number;
  gatesDueSoon: number;
  portfolioNpv: number;
}

export function portfolioSummary(projects: Project[]): PortfolioSummary {
  return {
    total: projects.length,
    inDevelopment: projects.filter((p) => p.stage === "Development" || p.stage === "Testing").length,
    gatesDueSoon: projects.filter((p) => /Jun|Jul/.test(p.nextGate)).length,
    portfolioNpv: projects.reduce((sum, p) => sum + p.npv, 0),
  };
}
