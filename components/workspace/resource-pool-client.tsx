"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Users, Shield } from "lucide-react";
import { useAppState } from "@/components/providers";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Workspace-level people directory. Distinct id / name / email come from the live
// SuprSend roster (project members ∪ everyone else in the workspace); "Projects" is
// how many project objects each person is subscribed to. Read-only for now — the
// "Add User" action is UI-only until it's wired.
interface PoolUser {
  distinctId: string;
  name: string;
  email: string | null;
  projects: number;
}

// The workspace Admin overseer — pinned above the pool, not one of the poolable people.
interface AdminUser {
  distinctId: string;
  name: string;
  email: string | null;
}

export function ResourcePoolClient() {
  const { workspace } = useAppState();
  // Remount per workspace for a fresh fetch + skeleton.
  return <Body key={workspace} />;
}

function Body() {
  const { tenant } = useAppState();
  const [rows, setRows] = React.useState<PoolUser[] | null>(null);
  const [admin, setAdmin] = React.useState<AdminUser | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [mRes, pRes] = await Promise.all([
          fetch(`/api/admin/project-members?tenant=${encodeURIComponent(tenant)}`, { cache: "no-store" }),
          fetch("/api/people", { cache: "no-store" }),
        ]);
        const mData = await mRes.json();
        const pData = await pRes.json();
        if (!active) return;
        if (!mData.ok) {
          setError(mData.error ?? "Couldn’t load the resource pool.");
          setRows([]);
          return;
        }
        // Everyone in the workspace = project members ∪ everyone-else (candidates).
        const people: { distinctId: string; name: string; email: string | null }[] = [
          ...(mData.members ?? []),
          ...(mData.candidates ?? []),
        ];
        // Subscription count = number of project objects each person belongs to.
        const counts = new Map<string, number>();
        if (pData.ok) {
          for (const proj of pData.projects ?? []) {
            for (const mem of proj.members ?? []) {
              counts.set(mem.id, (counts.get(mem.id) ?? 0) + 1);
            }
          }
          setAdmin(
            pData.admin
              ? { distinctId: pData.admin.id, name: pData.admin.name, email: pData.admin.email ?? null }
              : null,
          );
        }
        const merged: PoolUser[] = people
          .map((u) => ({ distinctId: u.distinctId, name: u.name, email: u.email, projects: counts.get(u.distinctId) ?? 0 }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setRows(merged);
      } catch {
        if (active) {
          setError("Couldn’t reach SuprSend.");
          setRows([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [tenant]);

  return (
    <>
      <PageHeader
        title="Resource Pool"
        description="Everyone in this workspace — the people who can be added to projects and receive notifications."
        actions={
          <div className="flex items-center gap-3">
            {rows !== null && (
              <span className="text-xs text-muted-foreground">
                {rows.length} {rows.length === 1 ? "person" : "people"}
              </span>
            )}
          </div>
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      {rows === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : rows.length === 0 && !admin ? (
        <EmptyState
          icon={Users}
          title="No people yet"
          description="Add employees in SuprSend and they’ll appear here as part of the workspace resource pool."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Distinct ID</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 text-right font-medium">Projects</th>
              </tr>
            </thead>
            <tbody>
              {/* Admin overseer pinned at the top — distinct from the poolable people:
                  it oversees every project and can't be added to one. */}
              {admin && (
                <tr className="border-b border-[var(--nav-active-border)] bg-[var(--nav-active)]">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{admin.distinctId}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Shield className="size-4 text-foreground" />
                      <span className="font-semibold text-foreground">{admin.name}</span>
                      <span className="rounded-full border border-[var(--nav-active-border)] bg-background/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
                        Workspace Admin
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{admin.email ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-foreground">All projects</td>
                </tr>
              )}
              {rows.map((u) => (
                <tr key={u.distinctId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{u.distinctId}</td>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{u.projects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
