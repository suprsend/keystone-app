"use client";

import { useRouter, usePathname } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppState } from "@/components/providers";
import { WORKSPACES, getWorkspace, type Workspace } from "@/lib/workspaces";
import { cn } from "@/lib/utils";

function Tile({ ws, className }: { ws: Workspace; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white text-[10px] font-bold",
        className,
      )}
      style={{ color: ws.accent }}
    >
      {ws.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ws.logo} alt="" className="size-full object-contain p-1" />
      ) : (
        ws.initial
      )}
    </span>
  );
}

export function WorkspaceSwitcher() {
  const { workspace, setWorkspace } = useAppState();
  const router = useRouter();
  const pathname = usePathname();
  const active = getWorkspace(workspace);

  function select(slug: Workspace["slug"]) {
    setWorkspace(slug);
    // A project detail of the old customer won't exist in the new one ("Project
    // not found"); land on the new customer's projects list instead.
    if (pathname.startsWith("/project/")) router.push("/project");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-white px-1.5 text-[13px] font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <Tile ws={active} className="size-5 rounded" />
        <span className="text-[10px] font-normal text-muted-foreground">Customer</span>
        <span className="max-w-32 truncate">{active.label}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[16rem]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch customer</DropdownMenuLabel>
        {WORKSPACES.map((w) => (
          <DropdownMenuItem key={w.slug} onSelect={() => select(w.slug)} className="gap-2">
            <Tile ws={w} />
            <span className="flex flex-col">
              <span className="text-sm font-medium leading-tight">{w.label}</span>
              <span className="text-xs leading-tight text-muted-foreground">{w.fullName}</span>
            </span>
            {w.slug === workspace && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
