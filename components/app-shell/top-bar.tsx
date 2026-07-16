"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppState, ADMIN_ACTOR } from "@/components/providers";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ViewingAs } from "./viewing-as";
import { AccountMenu } from "./account-menu";
import { InboxBell } from "./inbox-bell";
import { SearchProjects } from "./search-projects";
import { AddProjectDialog } from "@/components/project/add-project-dialog";

// One functional nav link. These are plain links (not menus), so they carry no
// caret — a chevron here would promise a dropdown that doesn't exist. The active
// section is marked with a full-strength label + an accent underline, so "you are
// here" is unmistakable; inactive links are muted and brighten on hover.
function NavLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative whitespace-nowrap py-3 font-semibold transition-colors outline-none",
        "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:rounded-sm",
        active
          ? "text-foreground after:bg-[var(--brand-blue)]"
          : "text-muted-foreground hover:text-foreground after:bg-transparent",
      )}
    >
      {label}
    </Link>
  );
}

// A non-wired nav item — present for product fidelity. Muted so it reads as
// unavailable, with a tooltip explaining how to enable it.
function NavStatic({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      aria-disabled
      className="cursor-default whitespace-nowrap py-3 font-semibold text-muted-foreground/50"
    >
      {label}
    </span>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { actorId, actorRole } = useAppState();
  const [addOpen, setAddOpen] = React.useState(false);

  // The viewer is the Admin overseer, or an impersonated user. Administer is only
  // functional for the Admin. Projects ALWAYS opens the projects listing — never the
  // old /user/work self-service view (the projects list is role-scoped anyway).
  const isAdminViewer = actorId === ADMIN_ACTOR || actorRole === "Admin";
  const projectsHref = "/project";

  const onAdmin = pathname.startsWith("/admin");
  const onProjects = pathname.startsWith("/project");
  const onWorkspace = pathname.startsWith("/workspace");

  return (
    <>
      {/* ── Primary product header ── */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-5 border-b border-border bg-background px-6 lg:px-8">
        <Link href="/project" className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-[17px] font-black leading-none tracking-tight text-foreground">Keystone</span>
        </Link>

        <nav className="hidden items-center gap-5 self-stretch text-[13px] xl:flex">
          <NavLink label="Workspace" href="/workspace/resource-pool" active={onWorkspace} />
          <NavLink label="Projects" href={projectsHref} active={onProjects} />
          {isAdminViewer ? (
            <NavLink label="Administer" href="/admin/preferences/defaults" active={onAdmin} />
          ) : (
            <NavStatic
              label="Administer"
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
