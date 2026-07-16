"use client";

import * as React from "react";
import { Bell } from "lucide-react";
import { useAppState } from "@/components/providers";
import { getTenant, isTenantId, type TenantId } from "@/lib/tenants";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TenantDefaultsClient } from "@/components/admin/tenant-defaults-client";
import { PreferenceCenter } from "@/components/preferences/preference-center";
import { ProjectResources } from "@/components/project/project-resources";
import { ProjectOverview, ProjectCostField } from "@/components/project/project-overview";
import { ProjectStateControl } from "@/components/project/project-state-control";
import { cn } from "@/lib/utils";

// Project detail (Projects). A project IS a SuprSend tenant (preferences/brand)
// AND object (membership).
const TABS: { key: string; label: string }[] = [
  { key: "overview", label: "Project Overview" },
  { key: "resources", label: "Resources" },
  { key: "notifications", label: "Notifications" },
];

export function ProjectDetailClient({ id }: { id: string }) {
  const { tenant, setTenant, actorRole, projects, projectsLoaded } = useAppState();
  const canManage = actorRole === "Admin" || actorRole === "Project Manager";
  const [active, setActive] = React.useState("overview");
  // Validate the project EXISTS live in this customer (seeded OR newly created), from
  // the shared projects context — not the static registry — so new projects are
  // navigable. undefined = loading, null = not found, string = the live project name.
  const found = projects.find((p) => p.tenantId === id);
  const liveName: string | null | undefined = !projectsLoaded ? undefined : found ? found.label : null;

  // Make the URL's project the active tenant so the reused surfaces scope to it.
  React.useEffect(() => {
    if (liveName != null && id !== tenant) setTenant(id as TenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, liveName]);

  if (liveName === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (liveName === null) {
    return (
      <EmptyState
        icon={Bell}
        title="Project not found"
        description="That project isn’t in the current customer. Pick another from the list."
      />
    );
  }
  // Wait until the active tenant is synced to THIS project before rendering the tabs —
  // their data is tenant-scoped (via the cookie), so rendering early would fetch the
  // previously-active project. The setTenant effect above syncs it, then we render.
  if (tenant !== id) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Seeded projects keep their rich metadata; new ones use the live object name.
  const seeded = isTenantId(id);
  const project = seeded ? getTenant(id as TenantId) : null;
  const title = project?.fullName ?? liveName;

  return (
    <>
      {/* Header — the project's scalar metadata (state, total cost) sits with the
          title; the tabs below hold the real content. */}
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <ProjectStateControl tenant={id} canManage={canManage} />
          <span className="text-muted-foreground/40">·</span>
          <ProjectCostField tenant={id} canManage={canManage} />
        </div>
      </div>

      {/* Project detail tab bar */}
      <div className="shrink-0 overflow-x-auto border-b border-border">
        <nav className="flex w-max items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                active === t.key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {active === "overview" && <ProjectOverview id={id} />}
      {active === "resources" && <ProjectResources />}
      {active === "notifications" && <ProjectNotifications tenantId={id} />}
    </>
  );
}

// Notifications tab. Three clearly-separated views (previously the last two were
// conflated under one "Project Settings" + an "Editing for" dropdown):
//  • My Settings      — the viewer's own preferences for this project (not Admin).
//  • User Settings    — a chosen member's preferences (Admin / PM team management).
//  • Project Settings — the project-wide defaults every member inherits.
function ProjectNotifications({ tenantId }: { tenantId: string }) {
  const { actorId, actorRole, users } = useAppState();
  const isAdmin = actorRole === "Admin";
  const isPm = actorRole === "Project Manager";
  const canManage = isAdmin || isPm;
  const hasMine = !isAdmin;

  const sub: { key: string; label: string }[] = [];
  if (canManage) sub.push({ key: "project", label: "Project Settings" });
  if (canManage) sub.push({ key: "user", label: "User Settings" });
  if (hasMine) sub.push({ key: "mine", label: "My Settings" });

  const [view, setView] = React.useState(sub[0]?.key ?? "mine");
  // The available views depend on the viewer's role — fall back when the current
  // pick isn't available (e.g. after switching who you view as).
  const activeView = sub.some((s) => s.key === view) ? view : sub[0]?.key;

  // Members editable in the "User Settings" view (the admin sentinel isn't a real
  // subscriber). `target` is derived: the explicit pick when it's still a valid
  // member, otherwise the first member — so no effect is needed to reset it.
  const editableUsers = React.useMemo(() => users.filter((u) => u.distinctId !== "admin"), [users]);
  const [picked, setPicked] = React.useState<string>("");
  const target = editableUsers.some((u) => u.distinctId === picked) ? picked : (editableUsers[0]?.distinctId ?? "");

  if (sub.length === 0) {
    return <p className="pt-2 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <section className="space-y-5 pt-2">
      {sub.length > 1 && (
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5 text-sm">
          {sub.map((s) => (
            <button
              key={s.key}
              onClick={() => setView(s.key)}
              className={cn(
                "rounded-md px-3 py-1 font-medium transition-colors",
                activeView === s.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {activeView === "mine" && hasMine && actorId && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Your notification settings for this project.</p>
          <PreferenceCenter
            key={actorId}
            distinctId={actorId}
            endpoint="/api/user-preferences"
            scope="project"
            tenantId={tenantId}
            emptyTitle="No notifications yet"
            emptyDescription="Notifications will appear here once they’re configured for this project."
          />
        </div>
      )}

      {activeView === "user" && canManage && (
        <div className="space-y-3">
          {/* Heading + picker read as one line: "Project Settings for [person ▾]" —
              the dropdown IS the person, so there's no redundant gap or second label. */}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">Project Settings for</h2>
            <select
              value={target}
              onChange={(e) => setPicked(e.target.value)}
              aria-label="Member to edit"
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {editableUsers.map((u) => (
                <option key={u.distinctId} value={u.distinctId}>
                  {u.name}
                  {u.role ? ` · ${u.role}` : ""}
                </option>
              ))}
            </select>
          </div>
          {target ? (
            <PreferenceCenter
              key={target}
              distinctId={target}
              endpoint="/api/user-preferences"
              scope="project"
              tenantId={tenantId}
              emptyTitle="No notifications yet"
              emptyDescription="Notifications will appear here once they’re configured for this project."
            />
          ) : (
            <p className="text-sm text-muted-foreground">No members on this project yet.</p>
          )}
        </div>
      )}

      {activeView === "project" && canManage && <TenantDefaultsClient />}
    </section>
  );
}
