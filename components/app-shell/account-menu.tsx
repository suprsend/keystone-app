"use client";

import { useRouter } from "next/navigation";
import { Settings, LogOut, UserCog } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppState, ADMIN_ACTOR } from "@/components/providers";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// The user-profile button (top-right avatar). Opens a menu with a Settings entry
// that navigates to the Account → Notifications page (a real page, not a modal).
export function AccountMenu() {
  const router = useRouter();
  const { actorId, users } = useAppState();
  const isAdmin = actorId === ADMIN_ACTOR;
  const me = users.find((u) => u.distinctId === actorId);
  const name = isAdmin ? "Admin" : me?.name ?? "Account";
  const initial = isAdmin ? "AD" : initials(name);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-8 items-center justify-center rounded-full bg-[#e4e8ec] text-[12px] font-bold text-[#3a4a5a] outline-none transition-colors hover:bg-[#d6dce1] focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Account menu"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-sm font-medium leading-tight">{name}</span>
          <span className="text-xs text-muted-foreground leading-tight">
            {isAdmin ? "Workspace administrator" : me?.email ?? "Team member"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/account/notifications")} className="gap-2">
          <Settings className="size-4 text-muted-foreground" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 text-muted-foreground" disabled>
          <UserCog className="size-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-muted-foreground" disabled>
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
