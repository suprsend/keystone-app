"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppState, ADMIN_ACTOR } from "@/components/providers";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ViewingAs } from "./viewing-as";
import { AccountMenu } from "./account-menu";
import { InboxBell } from "./inbox-bell";
import { SearchProjects } from "./search-projects";
import { AddProjectDialog } from "@/components/project/add-project-dialog";

// One functional nav link. Two weight tiers in the header:
//  • functional links (Workspace / Manage / Administer) → bold + dark
//  • decorative, non-wired items (NavStatic) → normal weight + grey
function NavLink({
  label,
  href,
  active,
  caret,
}: {
  label: string;
  href: string;
  active: boolean;
  caret?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-0.5 whitespace-nowrap py-1 font-bold transition-colors",
        active ? "text-foreground" : "text-foreground/80 hover:text-foreground",
      )}
    >
      {label}
      {caret && <ChevronDown className="size-3.5 opacity-70" />}
    </Link>
  );
}

// A decorative nav item — present for product fidelity, not wired. Rendered in a
// lighter tone than the functional links so non-working options read as inactive.
function NavStatic({
  label,
  caret,
  title,
}: {
  label: string;
  caret?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      aria-disabled
      className="flex cursor-default items-center gap-0.5 whitespace-nowrap py-1 font-normal text-muted-foreground/60"
    >
      {label}
      {caret && <ChevronDown className="size-3.5 opacity-70" />}
    </span>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { actorId, actorRole } = useAppState();
  const [addOpen, setAddOpen] = React.useState(false);

  // The viewer is the Admin overseer, or an impersonated user. Administer is only
  // functional for the Admin. Manage ALWAYS opens the projects listing — never the
  // old /user/work self-service view (the projects list is role-scoped anyway).
  const isAdminViewer = actorId === ADMIN_ACTOR || actorRole === "Admin";
  const manageHref = "/project";

  const onAdmin = pathname.startsWith("/admin");
  const onManage = pathname.startsWith("/project");
  const onWorkspace = pathname.startsWith("/workspace");

  return (
    <>
      {/* ── Primary product header ── */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-5 border-b border-border bg-background px-6 lg:px-8">
        <Link href="/project" className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-[17px] font-black leading-none tracking-tight text-foreground">Keystone</span>
        </Link>

        <nav className="hidden items-center gap-4 text-[13px] xl:flex">
          <NavLink label="Workspace" href="/workspace/resource-pool" active={onWorkspace} />
          <NavLink label="Manage" href={manageHref} active={onManage} caret />
          {isAdminViewer ? (
            <NavLink label="Administer" href="/admin/preferences/defaults" active={onAdmin} caret />
          ) : (
            <NavStatic
              label="Administer"
              caret
              title="Switch to Admin (Viewing as) to administer the workspace"
            />
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <WorkspaceSwitcher />
          <ViewingAs includeAdmin />
          <span className="mx-1 h-5 w-px bg-border" />
          <Button
            size="default"
            className="h-8 gap-1.5 px-3 text-[13px]"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-4" />
            Project
          </Button>
          <SearchProjects />
          <InboxBell />
          <AccountMenu />
        </div>
      </header>

      <AddProjectDialog key={addOpen ? "open" : "closed"} open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
