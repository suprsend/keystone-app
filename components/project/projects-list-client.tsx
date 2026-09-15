"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, FolderKanban } from "lucide-react";
import { useAppState } from "@/components/providers";
import { avatarColor, initials } from "@/lib/people";
import { PROJECT_MANAGER } from "@/lib/roles";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ProjectStateControl } from "@/components/project/project-state-control";

// Projects list (Manage). The project LIST, membership, roles and PM all come from
// SuprSend via the shared app context (/api/people → the project objects + their
// subscriptions), scoped to the active customer. Admin sees every project; anyone
// else sees only the projects they belong to. Only visual chrome is app-side.
export function ProjectsListClient() {
  const { activeWorkspace, actorId, actorRole, projects, projectsLoaded, refreshProjects } = useAppState();
  const router = useRouter();
  const isAdmin = actorRole === "Admin";

  const [busy, setBusy] = React.useState<string | null>(null);
  const loaded = projectsLoaded;

  const shown = isAdmin ? projects : projects.filter((p) => p.members.some((m) => m.id === actorId));

  const reassign = async (tenantId: string, distinctId: string) => {
    setBusy(tenantId);
    try {
      const res = await fetch("/api/admin/project-members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant: tenantId, distinctId, role: PROJECT_MANAGER }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) {
        toast.error("Couldn’t reassign PM", { description: d.error });
        return;
      }
      const name = (projects.find((p) => p.tenantId === tenantId)?.members ?? []).find((m) => m.id === distinctId)?.name ?? "the new manager";
      toast.success(`Project Manager updated — ${name} notified.`);
      await refreshProjects();
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Projects" description={`Projects in ${activeWorkspace?.label}.`} />

      {loaded && shown.length === 0 ? (
        isAdmin ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create one with + Project. It needs people to assign — add users to this workspace in the SuprSend dashboard first."
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No projects to list"
            description="You're not a member of any project in this customer."
          />
        )
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-semibold">Project</th>
                <th className="px-5 py-3 font-semibold">State</th>
                <th className="px-5 py-3 font-semibold">Manager</th>
                <th className="w-10 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                // Tile colour = the customer's brand colour (Administer → Brand).
                const accent = activeWorkspace?.accent || "var(--brand-blue)";
                const members = p.members;
                const pm = members.find((m) => m.role === PROJECT_MANAGER) ?? null;
                return (
                  <tr
                    key={p.tenantId}
                    onClick={() => router.push(`/project/${p.tenantId}`)}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/50"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex size-8 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
                          style={{ backgroundColor: accent }}
                        >
                          {initials(p.label)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{p.label}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span onClick={(e) => e.stopPropagation()}>
                        <ProjectStateControl tenant={p.tenantId} canManage={isAdmin} />
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {pm && (
                          <span
                            className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            style={{ backgroundColor: avatarColor(pm.id) }}
                          >
                            {initials(pm.name)}
                          </span>
                        )}
                        {isAdmin && members.length > 0 ? (
                          <span onClick={(e) => e.stopPropagation()}>
                            <select
                              value={pm?.id ?? ""}
                              disabled={busy === p.tenantId}
                              onChange={(e) => reassign(p.tenantId, e.target.value)}
                              className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-ring focus:outline-none disabled:opacity-50"
                            >
                              <option value="" disabled>
                                — Select PM
                              </option>
                              {members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </span>
                        ) : (
                          <span className="text-foreground">{pm?.name ?? "—"}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
