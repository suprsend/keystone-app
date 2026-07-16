"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResource } from "@/lib/use-resource";

// A project's state (In-flight / Paused / Completed), read from and written to the
// project OBJECT in SuprSend. Managers can toggle it; In-flight fires Project Started
// and Paused fires Project Paused (both on the object). Others see a read-only badge.
const STATES = ["In-flight", "Paused", "Completed"];

// Each state gets its own tone so status is readable at a glance.
const STATE_TONE: Record<string, string> = {
  "In-flight": "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  Paused: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  Completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

export function ProjectStateControl({
  tenant,
  canManage,
  onChanged,
}: {
  tenant: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const { data: state, setData: setState } = useResource(
    `/api/admin/project-state?tenant=${encodeURIComponent(tenant)}`,
    (d) => d.state as string,
    "Couldn’t load state.",
  );
  const [busy, setBusy] = React.useState(false);

  const change = async (next: string) => {
    const prev = state;
    setBusy(true);
    setState(next); // optimistic
    try {
      const r = await fetch("/api/admin/project-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant, state: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) {
        setState(prev);
        toast.error("Couldn’t update state", { description: d.error });
        return;
      }
      if (d.fired === "project-started") toast.success("Project started — team notified.");
      else if (d.fired === "project-paused") toast.success("Project paused — team notified.");
      else toast.success("State updated.");
      onChanged?.();
    } catch {
      setState(prev);
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setBusy(false);
    }
  };

  if (state === null) return <span className="text-sm text-muted-foreground">…</span>;

  // Status pill — reads as product status, not a form control. Managers get the same
  // pill as a click-to-change select (the native select is overlaid transparently so
  // it stays keyboard/screen-reader accessible); everyone else sees a static badge.
  const pill = cn(
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
    STATE_TONE[state] ?? "bg-muted text-muted-foreground",
  );

  if (!canManage) return <span className={pill}>{state}</span>;

  return (
    <span className={cn("relative", busy && "opacity-50")}>
      <span className={cn(pill, "pr-6")}>
        {state}
        <ChevronDown className="absolute right-2 top-1/2 size-3 -translate-y-1/2 opacity-60" />
      </span>
      <select
        aria-label="Project state"
        value={state}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </span>
  );
}
