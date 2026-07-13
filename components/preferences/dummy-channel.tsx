"use client";

import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TEAMS_NOTE } from "@/lib/preferences";

// The "Teams" channel is a DEMO PLACEHOLDER — Wellspring uses Microsoft Teams, but
// live Teams delivery isn't wired up in this example app (no Teams channel set up).
// So its toggle is a dummy: it flips locally for show but persists nothing, and a
// tooltip (TEAMS_NOTE, shared from lib/preferences) explains it. (Email + Inbox are
// the real, functional channels.)
export { TEAMS_NOTE };

export function DummyChannelSwitch({ size }: { size?: "sm" }) {
  const [on, setOn] = React.useState(true);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help">
            <Switch size={size} checked={on} onCheckedChange={setOn} aria-label="Teams (demo placeholder)" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{TEAMS_NOTE}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
