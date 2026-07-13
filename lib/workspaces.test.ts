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
    expect(getWorkspace("wellspring-honeywell").label).toBe("Honeywell");
    expect(getWorkspace("wellspring-hershey").label).toBe("Hershey");
    expect(getWorkspace("nope").slug).toBe(DEFAULT_WORKSPACE);
    expect(getWorkspace(null).slug).toBe(DEFAULT_WORKSPACE);
    expect(isWorkspaceSlug("wellspring-honeywell")).toBe(true);
    expect(isWorkspaceSlug("fiix-fedex")).toBe(false);
    expect(WORKSPACES.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getTenant", () => {
  it("resolves a known tenant id", () => {
    expect(getTenant("honeywell-aero").label).toBe("Aero Turbine Sensors Gen-2");
    expect(getTenant("hsy-reeses").label).toBe("Reese's Zero-Sugar");
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
    expect(isTenantId("honeywell-bms")).toBe(true);
    expect(isTenantId("hsy-kisses")).toBe(true);
    expect(isTenantId("acme")).toBe(false);
    expect(isTenantId(null)).toBe(false);
  });
});

describe("per-workspace projects", () => {
  it("lists only the projects for the active workspace", () => {
    const projects = getTenantsForWorkspace("wellspring-honeywell");
    expect(projects.map((t) => t.id)).toEqual(["honeywell-aero", "honeywell-bms"]);
    expect(getTenantsForWorkspace("wellspring-hershey").every((t) => t.workspace === "wellspring-hershey")).toBe(true);
  });

  it("defaults to the workspace's first project", () => {
    expect(getDefaultTenant("wellspring-honeywell").id).toBe("honeywell-aero");
    expect(getDefaultTenant("wellspring-hershey").id).toBe("hsy-reeses");
  });

  it("validates a tenant belongs to a workspace", () => {
    expect(isTenantOfWorkspace("wellspring-honeywell", "honeywell-aero")).toBe(true);
    expect(isTenantOfWorkspace("wellspring-honeywell", "hsy-reeses")).toBe(false);
    expect(isTenantOfWorkspace("wellspring-hershey", null)).toBe(false);
  });
});
