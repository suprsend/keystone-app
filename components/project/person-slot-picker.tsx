"use client";

import * as React from "react";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { avatarColor, initials } from "@/lib/people";

// Shared single-person picker (styled avatar dropdown). Used by the Resources role
// slots AND the New Project dialog so the UI is identical. The caller supplies the
// trigger element; this owns the option list (a clear item + avatar/name rows).
export function PersonSlotPicker({
  value,
  options,
  onChange,
  clearLabel = "— Unassigned",
  align = "end",
  trigger,
}: {
  value: string;
  options: { distinctId: string; name: string }[];
  onChange: (id: string) => void;
  clearLabel?: string;
  align?: "start" | "end";
  trigger: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      {/* No hard max-h — inherit the base content's available-height cap so the list
          never overflows the viewport (it was clipping when the menu flipped upward). */}
      <DropdownMenuContent align={align} className="w-64">
        <DropdownMenuItem onSelect={() => onChange("")} className="text-muted-foreground">
          {clearLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((p) => (
          <DropdownMenuItem key={p.distinctId} onSelect={() => onChange(p.distinctId)} className="gap-2">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: avatarColor(p.distinctId) }}
            >
              {initials(p.name)}
            </span>
            <span className="text-sm font-medium leading-tight">{p.name}</span>
            {value === p.distinctId && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
