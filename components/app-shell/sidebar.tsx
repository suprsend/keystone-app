"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, FileText, Activity, Palette, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

// Administer (workspace settings) left nav — the 4 surfaces. Shown ONLY on the
// Administer pages; the Dashboard has no panel.
const ADMIN_NAV: NavItem[] = [
  { label: "Message Templates", href: "/admin/templates", icon: FileText },
  { label: "Preferences", href: "/admin/preferences/defaults", icon: Bell },
  { label: "Brand", href: "/admin/brand", icon: Palette },
  { label: "Logs", href: "/admin/executions", icon: Activity },
];

// Workspace left nav — its own surface, reached from the "Workspace" header item.
const WORKSPACE_NAV: NavItem[] = [
  { label: "Resource Pool", href: "/workspace/resource-pool", icon: Users },
];

const ITEM_BASE = "flex items-center gap-2.5 border-l-[3px] px-3 py-2 text-sm font-medium transition-colors";

export function Sidebar() {
  const pathname = usePathname();
  // Pick the nav group for the current section; render no panel elsewhere (Dashboard).
  const nav = ADMIN_NAV.some((i) => pathname.startsWith(i.href))
    ? ADMIN_NAV
    : WORKSPACE_NAV.some((i) => pathname.startsWith(i.href))
      ? WORKSPACE_NAV
      : null;
  if (!nav) return null;

  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-white px-3 py-4 md:flex">
      {nav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              ITEM_BASE,
              active
                ? "rounded-l-none border-[var(--nav-active-border)] bg-[var(--nav-active)] text-foreground"
                : "border-transparent text-slate-600 hover:bg-[var(--nav-active-hover)] hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
