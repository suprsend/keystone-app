"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, User, Shield } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppState, ADMIN_ACTOR } from "@/components/providers";

// Every person you can view as — sourced LIVE from SuprSend (each project object's
// subscriptions) and scoped to the ACTIVE customer, via the shared app context so it
// stays in sync (e.g. a newly-created project + its people appear immediately).
export function ViewingAs({ includeAdmin = false }: { includeAdmin?: boolean } = {}) {
  const { actorId, setActorId, viewAs, workspace, projects, otherUsers } = useAppState();
  const router = useRouter();
  const pathname = usePathname();
  // The project page we're currently on (/project/<id>), if any — drives the
  // "stay vs go to listing" decision when switching who you're viewing as.
  const currentProjectId = /^\/project\/([^/]+)/.exec(pathname)?.[1];
  const isAdmin = actorId === ADMIN_ACTOR;

  const current =
    projects.flatMap((p) => p.members).find((m) => m.id === actorId) ??
    otherUsers.find((u) => u.id === actorId);
  const label = isAdmin ? "Admin" : current?.name ?? "Select…";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[13px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        {isAdmin ? <Shield className="size-3.5 text-muted-foreground" /> : <User className="size-3.5 text-muted-foreground" />}
        <span className="text-muted-foreground">Viewing as</span>
        <span className="font-medium">{label}</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-72 overflow-y-auto">
        {includeAdmin && (
          <>
            <DropdownMenuItem onSelect={() => setActorId(ADMIN_ACTOR)} className="gap-2">
              <Shield className="size-4 text-muted-foreground" />
              <span className="flex flex-col">
                <span className="text-sm font-medium leading-tight">Admin</span>
                <span className="text-xs text-muted-foreground leading-tight">Workspace overseer</span>
              </span>
              {isAdmin && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {projects.map((p) => (
          <div key={p.tenantId}>
            <DropdownMenuLabel className="text-[11px] text-muted-foreground/80">{p.label}</DropdownMenuLabel>
            {p.members.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">No members.</div>
            )}
            {p.members.map((m) => (
              <DropdownMenuItem
                key={`${p.tenantId}:${m.id}`}
                onSelect={() => {
                  if (currentProjectId === p.tenantId) {
                    // Same project as the one you're viewing → just change the
                    // actor and stay on the current tab (don't reset to listing).
                    setActorId(m.id);
                  } else {
                    // Different project (or not on a project page) → switch to it
                    // and show the project listing.
                    viewAs(m.id, workspace, p.tenantId);
                    router.push("/project");
                  }
                }}
                className="gap-2"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium leading-tight">{m.name}</span>
                  <span className="text-xs text-muted-foreground leading-tight">{m.role}</span>
                </span>
                {!isAdmin && m.id === actorId && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </div>
        ))}

        {otherUsers.length > 0 && (
          <div>
            {projects.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] text-muted-foreground/80">Other users</DropdownMenuLabel>
            {otherUsers.map((u) => (
              <DropdownMenuItem
                key={`other:${u.id}`}
                onSelect={() => {
                  // Not a member of any project — set them as the actor and show the
                  // Projects listing, which renders empty (they belong to no project).
                  // Stay in the current customer; no project/tenant to switch to.
                  setActorId(u.id);
                  router.push("/project");
                }}
                className="gap-2"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium leading-tight">{u.name}</span>
                  <span className="text-xs text-muted-foreground leading-tight">{u.role || "No project"}</span>
                </span>
                {!isAdmin && u.id === actorId && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
