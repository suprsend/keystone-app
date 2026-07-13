"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, HelpCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTenant } from "@/lib/tenants";
import { useAppState, ADMIN_ACTOR } from "@/components/providers";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ViewingAs } from "./viewing-as";
import { AccountMenu } from "./account-menu";
import { InboxBell } from "./inbox-bell";
import { SearchProjects } from "./search-projects";
import { SopheonLogo } from "./sopheon-logo";
import { AddProjectDialog } from "@/components/project/add-project-dialog";

// Breadcrumb derived from the route — mirrors Accolade's "Accolade Projects / …"
// strip under the header. Crumbs with an href are clickable (except the last).
type Crumb = { label: string; href?: string };
function crumbFor(pathname: string): Crumb[] {
  const root: Crumb = { label: "Accolade Projects", href: "/admin/dashboard" };
  const manage: Crumb = { label: "Manage", href: "/project" };
  if (pathname.startsWith("/admin/dashboard")) return [root, { label: "Dashboard" }];
  if (pathname.startsWith("/admin/preferences")) return [root, { label: "Administer" }, { label: "Preferences" }];
  if (pathname.startsWith("/admin/templates")) return [root, { label: "Administer" }, { label: "Message Templates" }];
  if (pathname.startsWith("/admin/brand")) return [root, { label: "Administer" }, { label: "Brand" }];
  if (pathname.startsWith("/admin/executions")) return [root, { label: "Administer" }, { label: "Logs" }];
  if (pathname.startsWith("/workspace/resource-pool")) return [root, { label: "Workspace" }, { label: "Resource Pool" }];
  if (pathname.startsWith("/admin")) return [root, { label: "Administer" }];
  if (pathname.startsWith("/account")) return [root, { label: "Account" }, { label: "Notifications" }];
  if (pathname.startsWith("/project/")) {
    const id = pathname.split("/")[2];
    return [root, manage, { label: "Projects", href: "/project" }, { label: getTenant(id).label }];
  }
  if (pathname.startsWith("/project")) return [root, manage, { label: "Projects" }];
  return [root];
}

// One functional nav link. Three weight tiers in the header:
//  • truly functional links (Workspace / Manage / Administer) → BOLD + dark
//  • `dummy` links that navigate but show placeholder content (Dashboard) → semibold
//  • decorative, non-wired items (NavStatic) → normal weight + grey
function NavLink({
  label,
  href,
  active,
  caret,
  dummy,
}: {
  label: string;
  href: string;
  active: boolean;
  caret?: boolean;
  dummy?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-0.5 whitespace-nowrap py-1 transition-colors",
        dummy ? "font-semibold" : "font-bold",
        active
          ? "text-[#13202c]"
          : dummy
            ? "text-[#5b6b7b] hover:text-[#13202c]"
            : "text-[#1b2733] hover:text-[#13202c]",
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
      className="flex cursor-default items-center gap-0.5 whitespace-nowrap py-1 font-normal text-[#b4bcc4]"
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

  const onDashboard = pathname.startsWith("/admin/dashboard");
  const onAdmin = pathname.startsWith("/admin") && !onDashboard;
  const onManage = pathname.startsWith("/project");
  const onWorkspace = pathname.startsWith("/workspace");

  const crumbs = crumbFor(pathname);

  return (
    <>
      {/* ── Primary product header (matches Accolade Projects) ── */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-5 border-b border-border bg-white px-6 lg:px-8">
        <Link href="/admin/dashboard" className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-[17px] leading-none tracking-tight">
            <span className="font-black text-[#1b2733]">Accolade</span>
            <span className="font-semibold text-[#4a5a6a]">Projects</span>
          </span>
          <span className="text-[18px] font-black leading-none tracking-tight text-[#1b2733]">QA</span>
        </Link>

        <nav className="hidden items-center gap-4 text-[13px] xl:flex">
          <NavLink label="Dashboard" href="/admin/dashboard" active={onDashboard} dummy />
          <NavLink label="Workspace" href="/workspace/resource-pool" active={onWorkspace} />
          <NavStatic label="Plan" caret />
          <NavLink label="Manage" href={manageHref} active={onManage} caret />
          <NavStatic label="Reports & Analytics" />
          <NavStatic label="Timecards" caret />
          {isAdminViewer ? (
            <NavLink label="Administer" href="/admin/preferences/defaults" active={onAdmin} caret />
          ) : (
            <NavStatic
              label="Administer"
              caret
              title="Switch to Admin (Viewing as) to administer the workspace"
            />
          )}
          <NavStatic label="Log Out" />
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <Button
            size="default"
            className="h-8 gap-1.5 px-3 text-[13px]"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-4" />
            Project
          </Button>
          <SearchProjects />
          <SopheonLogo className="hidden lg:flex" />
          <button
            aria-label="Help"
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HelpCircle className="size-5" />
          </button>
          <InboxBell />
          <AccountMenu />
        </div>
      </header>

      {/* ── Context strip: breadcrumb (left) + demo controls (right) ── */}
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-[#f2f2f2] px-6 py-1.5 lg:px-8">
        <nav className="flex items-center gap-1.5 text-[12px] text-muted-foreground" aria-label="Breadcrumb">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={c.label + i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-border">/</span>}
                {c.href && !last ? (
                  <Link href={c.href} className="transition-colors hover:text-foreground hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span className={cn(last && "font-medium text-foreground")}>{c.label}</span>
                )}
              </span>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <WorkspaceSwitcher />
          <span className="mx-0.5 h-5 w-px bg-border" />
          <ViewingAs includeAdmin />
        </div>
      </div>

      <AddProjectDialog key={addOpen ? "open" : "closed"} open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
