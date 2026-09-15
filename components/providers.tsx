"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import type { WorkspaceInfo, WorkspaceSlug } from "@/lib/workspaces";
import type { WorkUser } from "@/lib/server/users";

interface AppState {
  /** Workspaces the app can use — read live from SuprSend (see listWorkspaces). */
  workspaces: WorkspaceInfo[];
  /** Active customer workspace. */
  workspace: WorkspaceSlug;
  /** The active workspace's name / logo / colour; null when none is connected. */
  activeWorkspace: WorkspaceInfo | null;
  setWorkspace: (slug: WorkspaceSlug) => void;
  /** Active project (tenant) inside the workspace. Drives brand + scoping. "" when
   * the workspace has no projects. */
  tenant: string;
  setTenant: (id: string) => void;
  /** The employee currently being impersonated. The sentinel "admin" = the
   * workspace admin (overseer, not a project member). */
  actorId: string;
  setActorId: (id: string) => void;
  /** Impersonate a specific person across the WHOLE app: switches the customer +
   * project to theirs and sets them as the actor, atomically. */
  viewAs: (userId: string, ws: WorkspaceSlug, tenant: string) => void;
  /** Role of the current viewer on the active project — drives Projects-view
   * gating. "Admin" for the admin sentinel; else the member's role on the project;
   * "" while the roster loads. */
  actorRole: string;
  /** Live SuprSend subscribers for the active tenant (the "viewing as" + Send-test roster). */
  users: WorkUser[];
  usersLoading: boolean;
  /** Re-fetch the live roster (call after add/remove in the Users tab). */
  refreshUsers: () => Promise<void>;
  /** Live projects in the active customer (from /api/people) + their members — the
   * single source for the Projects list, the "Viewing as" picker, project search and
   * project-page validation. Refresh after creating a project so they all update. */
  projects: AppProject[];
  projectsLoaded: boolean;
  refreshProjects: () => Promise<void>;
  /** People in the customer who belong to NO project — shown as "Other users" in the
   * Viewing-as picker. Viewing as one of these yields an empty Projects list. */
  otherUsers: OtherUser[];
}

export interface AppProject {
  tenantId: string;
  label: string;
  members: { id: string; name: string; role: string }[];
}

export interface OtherUser {
  id: string;
  name: string;
  role: string;
}

const AppContext = React.createContext<AppState | null>(null);

export function useAppState(): AppState {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within <AppProviders>");
  return ctx;
}

/** Viewer sentinel for the workspace admin (overseer, not a project member). */
export const ADMIN_ACTOR = "admin";

const YEAR = 60 * 60 * 24 * 365;
function writeCookie(key: string, value: string) {
  document.cookie = `${key}=${value}; path=/; max-age=${YEAR}; samesite=lax`;
}

export function AppProviders({
  children,
  workspaces,
  initialWorkspace,
  initialTenant,
  initialActor,
}: {
  children: React.ReactNode;
  workspaces: WorkspaceInfo[];
  initialWorkspace: WorkspaceSlug;
  initialTenant: string;
  initialActor: string;
}) {
  const [workspace, setWs] = React.useState<WorkspaceSlug>(() => {
    // Pin the server's pick in the cookie before any child fetches, so API routes
    // resolve the same workspace the page shows.
    if (typeof document !== "undefined" && initialWorkspace) writeCookie("ws", initialWorkspace);
    return initialWorkspace;
  });
  const [tenant, setTen] = React.useState<string>(initialTenant);
  const [actorId, setAct] = React.useState<string>(initialActor);
  const [users, setUsers] = React.useState<WorkUser[]>([]);
  const [usersLoading, setUsersLoading] = React.useState(true);
  const [projects, setProjects] = React.useState<AppProject[]>([]);
  const [otherUsers, setOtherUsers] = React.useState<OtherUser[]>([]);
  const [projectsLoaded, setProjectsLoaded] = React.useState(false);

  const setActorId = React.useCallback((id: string) => {
    setAct(id);
    writeCookie("actor", id);
  }, []);

  // Load the live roster for the active tenant. Resolves the impersonated actor:
  // keep the current one if it still exists, otherwise fall back to the first user.
  const refreshUsers = React.useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const d = await res.json();
      const list: WorkUser[] = d.ok && Array.isArray(d.users) ? d.users : [];
      setUsers(list);
      setAct((prev) => {
        // Keep the admin sentinel across tenant switches (it's not in the roster).
        if (prev === ADMIN_ACTOR) return prev;
        if (prev && list.some((u) => u.distinctId === prev)) return prev;
        const next = list[0]?.distinctId ?? "";
        if (next) writeCookie("actor", next);
        return next;
      });
    } catch {
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Re-fetch whenever the workspace or tenant changes (the roster is per tenant).
  React.useEffect(() => {
    void (async () => {
      await refreshUsers();
    })();
  }, [workspace, tenant, refreshUsers]);

  // Live projects in the active customer (+ members). One source for the listing,
  // the "Viewing as" picker, search and project-page validation. Call after creating
  // a project so all of them update without a manual reload.
  const refreshProjects = React.useCallback(async () => {
    try {
      const res = await fetch("/api/people", { cache: "no-store" });
      const d = await res.json();
      setProjects(d.ok && Array.isArray(d.projects) ? (d.projects as AppProject[]) : []);
      setOtherUsers(d.ok && Array.isArray(d.otherUsers) ? (d.otherUsers as OtherUser[]) : []);
    } catch {
      setProjects([]);
      setOtherUsers([]);
    } finally {
      setProjectsLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    // Projects are per customer (workspace), not per tenant.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjectsLoaded(false);
    void refreshProjects();
  }, [workspace, refreshProjects]);

  // Keep the active project pointed at one that exists in this workspace: the first
  // live project when the current one is gone (or unset), "" when there are none.
  React.useEffect(() => {
    if (!projectsLoaded || projects.some((p) => p.tenantId === tenant)) return;
    const next = projects[0]?.tenantId ?? "";
    if (next === tenant) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTen(next);
    writeCookie("tenant", next);
  }, [projectsLoaded, projects, tenant]);

  const setTenant = React.useCallback((id: string) => {
    setTen(id);
    writeCookie("tenant", id);
    // The new project has a different roster — show loading + clear the actor;
    // refreshUsers (triggered by the tenant change) resolves it to a valid user.
    // Keep the admin sentinel (the overseer isn't tied to a project roster).
    setUsersLoading(true);
    setAct((prev) => (prev === ADMIN_ACTOR ? prev : ""));
  }, []);

  // Impersonate a specific person anywhere in the app: switch to their customer +
  // project and set them as the actor in one go. refreshUsers (fired by the
  // ws/tenant change) keeps this actor because they're in the new roster.
  const viewAs = React.useCallback((userId: string, ws: WorkspaceSlug, ten: string) => {
    setWs(ws);
    writeCookie("ws", ws);
    setTen(ten);
    writeCookie("tenant", ten);
    setUsersLoading(true);
    setAct(userId);
    writeCookie("actor", userId);
  }, []);

  const setWorkspace = React.useCallback((slug: WorkspaceSlug) => {
    setWs(slug);
    writeCookie("ws", slug);
    // Switching customer changes the available projects — clear the project until
    // the new workspace's projects load (then its first one is picked). Keep the
    // Admin overseer if active; otherwise reset the impersonated actor.
    setTen("");
    writeCookie("tenant", "");
    setUsersLoading(true);
    setAct((prev) => (prev === ADMIN_ACTOR ? prev : ""));
  }, []);

  const activeWorkspace = workspaces.find((w) => w.slug === workspace) ?? null;

  // The current viewer's role on the active project (Projects-view gating).
  const actorRole =
    actorId === ADMIN_ACTOR ? "Admin" : users.find((u) => u.distinctId === actorId)?.role ?? "";

  // The app chrome uses a single consistent Keystone palette (navy primary, blue
  // accents) — like the real Keystone product. White-label colour comes from the
  // data/branding surfaces, not by recolouring the chrome per project.
  return (
    <AppContext.Provider
      value={{
        workspaces,
        workspace,
        activeWorkspace,
        setWorkspace,
        tenant,
        setTenant,
        actorId,
        setActorId,
        viewAs,
        actorRole,
        users,
        usersLoading,
        refreshUsers,
        projects,
        projectsLoaded,
        refreshProjects,
        otherUsers,
      }}
    >
      <TooltipProvider delayDuration={200}>
        <div className="flex min-h-svh flex-col">
          {children}
        </div>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </AppContext.Provider>
  );
}
