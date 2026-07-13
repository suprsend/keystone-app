"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Plus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAppState } from "@/components/providers";
import { getWorkspace } from "@/lib/workspaces";
import { avatarColor, initials } from "@/lib/people";
import { PersonSlotPicker } from "@/components/project/person-slot-picker";

interface Person {
  distinctId: string;
  name: string;
}

// Single-occupancy roles, in order. PM is required.
const SINGLE = [
  { key: "pm", role: "Project Manager", label: "Project Manager", required: true },
  { key: "po", role: "Process Owner", label: "Process Owner", required: false },
  { key: "sp", role: "Project Sponsor", label: "Project Sponsor", required: false },
] as const;

// Create a project: name + people picked from the customer's resource pool (no user
// creation here). On success, routes to the new project. Reuses the same role model
// as Resources (#6). The create APIs (object/tenant/subscriptions) are live.
export function AddProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const { workspace, refreshUsers, refreshProjects } = useAppState();
  const customer = getWorkspace(workspace);
  const [name, setName] = React.useState("");
  const [pool, setPool] = React.useState<Person[]>([]);
  const [single, setSingle] = React.useState<Record<string, string>>({});
  const [team, setTeam] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  // The dialog is remounted on open (key in the parent), so state starts fresh —
  // no manual reset needed. Just load the customer's people pool.
  React.useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch("/api/admin/project-members", { cache: "no-store" });
        const d = await res.json();
        if (!d.ok) return;
        const all = [...(d.members ?? []), ...(d.candidates ?? [])] as Person[];
        const map = new Map(all.map((p) => [p.distinctId, { distinctId: p.distinctId, name: p.name }]));
        setPool([...map.values()].sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        /* leave empty */
      }
    })();
  }, [open]);

  const nameOf = (id: string) => pool.find((p) => p.distinctId === id)?.name ?? id;
  const taken = new Set([...Object.values(single).filter(Boolean), ...team]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Project name is required.");
    if (!single["pm"]) return toast.error("A Project Manager is required.");
    // A person holds ONE role — single roles win over team membership.
    const members: { distinctId: string; role: string }[] = [];
    const used = new Set<string>();
    for (const s of SINGLE) {
      const id = single[s.key];
      if (id && !used.has(id)) {
        members.push({ distinctId: id, role: s.role });
        used.add(id);
      }
    }
    for (const id of team) {
      if (!used.has(id)) {
        members.push({ distinctId: id, role: "Team Member" });
        used.add(id);
      }
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/create-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, members }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) {
        toast.error("Couldn’t create project", { description: d.error });
        return;
      }
      toast.success(`Project “${trimmed}” created.`);
      onOpenChange(false);
      // Refresh the shared projects list so the listing, "Viewing as" picker and the
      // new project page all see it before we navigate (no manual reload needed).
      await refreshProjects();
      router.push(`/project/${d.id}`);
      void refreshUsers().catch(() => {});
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Creates a project in {customer.label} and adds the people you choose.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="np-name">Project name</Label>
            <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Smart Controls v5" autoComplete="off" />
          </div>

          {SINGLE.map((s) => {
            const selName = pool.find((p) => p.distinctId === single[s.key])?.name;
            return (
              <div key={s.key} className="space-y-1.5">
                <Label>
                  {s.label}
                  {s.required && <span className="text-destructive"> *</span>}
                </Label>
                <PersonSlotPicker
                  value={single[s.key] ?? ""}
                  options={pool.filter((p) => !taken.has(p.distinctId) || single[s.key] === p.distinctId)}
                  onChange={(id) => setSingle((m) => ({ ...m, [s.key]: id }))}
                  clearLabel="— None"
                  align="start"
                  trigger={
                    <Button variant="outline" className="w-full justify-between font-normal">
                      {selName ?? <span className="text-muted-foreground">Select…</span>}
                      <ChevronDown className="size-4 opacity-70" />
                    </Button>
                  }
                />
              </div>
            );
          })}

          <div className="space-y-1.5">
            <Label>Team Members</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {team.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                  {nameOf(id)}
                  <button onClick={() => setTeam((t) => t.filter((x) => x !== id))} aria-label={`Remove ${nameOf(id)}`} className="text-muted-foreground hover:text-foreground">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1">
                    <Plus className="size-3.5" /> Add
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Add from {customer.label}</DropdownMenuLabel>
                  {pool.filter((p) => !taken.has(p.distinctId)).length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Everyone is assigned.</div>
                  )}
                  {pool
                    .filter((p) => !taken.has(p.distinctId))
                    .map((p) => (
                      <DropdownMenuItem key={p.distinctId} onSelect={() => setTeam((t) => [...t, p.distinctId])} className="gap-2">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: avatarColor(p.distinctId) }}>
                          {initials(p.name)}
                        </span>
                        {p.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !name.trim() || !single["pm"]}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
