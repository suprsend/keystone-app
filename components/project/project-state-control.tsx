"use client";

import * as React from "react";
import { toast } from "sonner";
import { useResource } from "@/lib/use-resource";

// A project's state (In-flight / Paused / Completed), read from and written to the
// project OBJECT in SuprSend. Managers can toggle it; In-flight fires Project Started
// and Paused fires Project Paused (both on the object). Others see read-only text.
const STATES = ["In-flight", "Paused", "Completed"];

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
  if (!canManage) return <span className="text-foreground">{state}</span>;

  return (
    <select
      value={state}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-ring focus:outline-none disabled:opacity-50"
    >
      {STATES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
