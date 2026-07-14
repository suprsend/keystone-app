import { describe, it, expect } from "vitest";
import { WORKSPACES, DEFAULT_WORKSPACE, getWorkspace, isWorkspaceSlug } from "@/lib/workspaces";
import {
  TENANTS,
  getTenant,
  isTenantId,
  getTenantsForWorkspace,
  getDefaultTenant,
  isTenantOfWorkspace,
} from "@/lib/tenants";

describe("workspaces (one per customer)", () => {
  it("resolves known customer slugs and falls back otherwise", () => {
    expect(getWorkspace("acme").label).toBe("Acme");
    expect(getWorkspace("globex").label).toBe("Globex");
    expect(getWorkspace("nope").slug).toBe(DEFAULT_WORKSPACE);
    expect(getWorkspace(null).slug).toBe(DEFAULT_WORKSPACE);
    expect(isWorkspaceSlug("acme")).toBe(true);
    expect(isWorkspaceSlug("fiix-fedex")).toBe(false);
    expect(WORKSPACES.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getTenant", () => {
  it("resolves a known tenant id", () => {
    expect(getTenant("acme-aero").label).toBe("Aero Turbine Sensors Gen-2");
    expect(getTenant("globex-bar").label).toBe("Zero-Sugar Bar");
  });

  it("falls back to the first tenant for unknown / missing ids", () => {
    const fallback = TENANTS[0];
    expect(getTenant("does-not-exist")).toBe(fallback);
    expect(getTenant(null)).toBe(fallback);
    expect(getTenant(undefined)).toBe(fallback);
  });
});

describe("isTenantId", () => {
  it("is true only for registered tenants", () => {
    expect(isTenantId("acme-bms")).toBe(true);
    expect(isTenantId("globex-minis")).toBe(true);
    expect(isTenantId("acme")).toBe(false);
    expect(isTenantId(null)).toBe(false);
  });
});

describe("per-workspace projects", () => {
  it("lists only the projects for the active workspace", () => {
    const projects = getTenantsForWorkspace("acme");
    expect(projects.map((t) => t.id)).toEqual(["acme-aero", "acme-bms"]);
    expect(getTenantsForWorkspace("globex").every((t) => t.workspace === "globex")).toBe(true);
  });

  it("defaults to the workspace's first project", () => {
    expect(getDefaultTenant("acme").id).toBe("acme-aero");
    expect(getDefaultTenant("globex").id).toBe("globex-bar");
  });

  it("validates a tenant belongs to a workspace", () => {
    expect(isTenantOfWorkspace("acme", "acme-aero")).toBe(true);
    expect(isTenantOfWorkspace("acme", "globex-bar")).toBe(false);
    expect(isTenantOfWorkspace("globex", null)).toBe(false);
  });
});
