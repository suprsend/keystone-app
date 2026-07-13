"use client";

import { cn } from "@/lib/utils";

// Left sub-nav for the Account section (mirrors Accolade: Details / Change Password /
// Delegate Work / Delegate Permissions / Notifications). Only Notifications is wired
// in this demo; the rest are present for product fidelity.
const ITEMS = [
  { key: "details", label: "Details" },
  { key: "change-password", label: "Change Password" },
  { key: "delegate-work", label: "Delegate Work" },
  { key: "delegate-permissions", label: "Delegate Permissions" },
  { key: "notifications", label: "Notifications" },
] as const;

export function AccountNav({ active }: { active: string }) {
  return (
    <nav aria-label="Account" className="w-56 shrink-0 self-start">
      <ul className="space-y-0.5">
        {ITEMS.map((it) => {
          const isActive = it.key === active;
          return (
            <li key={it.key}>
              <span
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex cursor-default items-center rounded-md border-l-2 px-3 py-2 text-sm font-medium uppercase tracking-wide",
                  isActive
                    ? "border-[var(--brand-blue)] bg-[var(--brand-blue-soft)]/40 text-[var(--brand-blue)]"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {it.label}
              </span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
