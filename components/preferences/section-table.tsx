"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CHANNEL_ICON, CHANNEL_LABEL } from "@/lib/message-display";
import { PREF_CHANNELS, TEAMS_CHANNEL_KEY, TEAMS_NOTE } from "@/lib/preferences";

/**
 * A column header label with a small info icon that explains the column on hover.
 * Used across the notification-settings tables (project / member / admin) so the
 * non-obvious columns — Active, Default, Preference, Frequency, etc. — read the
 * same everywhere.
 */
export function HeaderTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`What “${label}” means`}
              className="text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
            >
              <Info className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{tip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

/**
 * The channel icons shown in a preference-table header (Email / Inbox / Teams).
 * Teams is a demo placeholder, so its icon carries a hover tooltip saying so — the
 * same way Active / Default / Except headers explain themselves via {@link HeaderTip}.
 */
export function ChannelHeaderIcons() {
  return (
    <div className="flex items-center gap-3">
      {PREF_CHANNELS.map((ch) => {
        const Icon = CHANNEL_ICON[ch];
        const label = CHANNEL_LABEL[ch] ?? ch;
        const glyph = Icon ? <Icon className="size-4 text-foreground" /> : <>{label}</>;
        if (ch !== TEAMS_CHANNEL_KEY) {
          return (
            <span key={ch} className="flex w-10 justify-center" title={label} aria-label={label}>
              {glyph}
            </span>
          );
        }
        // Teams = demo placeholder → render its icon with a small ℹ info button
        // beside it, exactly like the Active / Default / Except headers (HeaderTip).
        return (
          <span key={ch} className="flex w-10 items-center justify-center gap-1" aria-label={label}>
            {glyph}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`What “${label}” means`}
                    className="text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                  >
                    <Info className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{TEAMS_NOTE}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Collapsible-section open/closed state shared by the preference tables.
 * Returns `isCollapsed(section)` and `toggle(section)`.
 */
export function useCollapsibleSections() {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const toggle = React.useCallback((section: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);
  return { isCollapsed: (section: string) => collapsed.has(section), toggle };
}

/**
 * The "▸ SECTION" header row that spans a preference table. Pass `onToggle`
 * for the collapsible tables (admin defaults + per-project); omit it for a
 * static, non-collapsible header (the account-level view).
 */
export function SectionHeaderRow({
  label,
  colSpan,
  collapsed,
  onToggle,
}: {
  label: string;
  colSpan: number;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <tr
      className={"border-b border-border bg-muted/20" + (onToggle ? " cursor-pointer select-none hover:bg-muted/40" : "")}
      onClick={onToggle}
    >
      <td colSpan={colSpan} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {onToggle && (collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />)}
          {label}
        </span>
      </td>
    </tr>
  );
}
