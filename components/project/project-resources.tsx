"use client";

import * as React from "react";
import { toast } from "sonner";
import { Users, UserPlus, Trash2, ChevronDown } from "lucide-react";
import { useAppState } from "@/components/providers";
import { avatarColor, initials } from "@/lib/people";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PersonSlotPicker } from "@/components/project/person-slot-picker";

interface Member {
  distinctId: string;
  name: string;
  email: string | null;
  role: string | null;
}
interface Candidate {
  distinctId: string;
  name: string;
  email: string | null;
}

// Resources = the people on this project and their roles, backed by the project
// OBJECT's subscriptions. Admin / PM assign roles + manage team members here (each
// writes straight to the object). New users are NOT created here — only existing
// people from the customer's resource pool are mapped onto the project.
export function ProjectResources() {
  const { tenant, actorRole, refreshUsers } = useAppState();
  const isAdmin = actorRole === "Admin";
  const canManage = isAdmin || actorRole === "Project Manager";
  return <Body key={tenant} canManage={canManage} isAdmin={isAdmin} refreshUsers={refreshUsers} />;
}

function Body({ canManage, isAdmin, refreshUsers }: { canManage: boolean; isAdmin: boolean; refreshUsers: () => Promise<void> }) {
  const [members, setMembers] = React.useState<Member[] | null>(null);
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [busy, setBusy] = React.useState(false);

  const reload = async () => {
    try {
      const res = await fetch("/api/admin/project-members", { cache: "no-store" });
      const d = await res.json();
      if (d.ok) {
        setMembers(d.members);
        setCandidates(d.candidates);
      } else {
        setMembers([]);
      }
    } catch {
      setMembers([]);
    }
  };

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/project-members", { cache: "no-store" });
        const d = await res.json();
        if (!active) return;
        if (d.ok) {
          setMembers(d.members);
          setCandidates(d.candidates);
        } else {
          setMembers([]);
        }
      } catch {
        if (active) setMembers([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function mutate(fn: () => Promise<Response>, fail: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fn();
      const d = await res.json().catch(() => ({}));
      if (!d.ok) {
        toast.error(fail, { description: d.error });
        return false;
      }
      await reload();
      await refreshUsers(); // keep Viewing-as roles / role-gating in sync
      return true;
    } catch {
      toast.error("Couldn’t reach SuprSend.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const add = (distinctId: string) =>
    mutate(
      () =>
        fetch("/api/admin/project-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ distinctId, role: "Team Member" }),
        }),
      "Couldn’t add member",
    );
  const setRole = (distinctId: string, role: string) =>
    mutate(
      () =>
        fetch("/api/admin/project-members", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ distinctId, role }),
        }),
      "Couldn’t update role",
    );
  // Assign a single-occupancy slot (PM / Process Owner / Sponsor). Picking a person
  // assigns them and REMOVES the current holder from the project (replacement);
  // picking "— Unassigned" demotes the current holder back to Team Member (clear).
  // A PM change fires Project Assigned.
  const setSlot = async (role: string, distinctId: string, currentHolderId: string | null) => {
    if (distinctId) {
      const replacedName =
        currentHolderId && currentHolderId !== distinctId
          ? (members ?? []).find((m) => m.distinctId === currentHolderId)?.name ?? null
          : null;
      const ok = await setRole(distinctId, role);
      if (ok && replacedName) {
        toast(`${replacedName} removed as ${role} and from the project.`, {
          description: `To add them back: Add member → ${replacedName}.`,
        });
      }
      return ok;
    }
    if (currentHolderId) return setRole(currentHolderId, "Team Member");
  };
  const remove = (distinctId: string) =>
    mutate(
      () => fetch(`/api/admin/project-members?distinct_id=${encodeURIComponent(distinctId)}`, { method: "DELETE" }),
      "Couldn’t remove member",
    );

  if (members === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  const holder = (role: string) => members.find((m) => m.role === role) ?? null;
  const team = members.filter((m) => m.role === "Team Member");
  // "Others" = object subscribers who aren't a single-role holder or Team Member —
  // watchers (CC) and blank-role subscribers. READ-ONLY here: who they receive (the
  // per-category recipient targeting) is managed in Notification settings, not here.
  const others = members.filter((m) => !ROLE_BUCKETS.includes(m.role ?? ""));
  // Slot picker options = the WHOLE customer pool (members + everyone else in this
  // customer) — assign anyone to a role directly, no "add as Team Member first" step.
  const poolOptions = [...members, ...candidates]
    .map((p) => ({ distinctId: p.distinctId, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      {/* Single-occupancy roles — each its own headed section, matching Team Members:
          the role is the heading, then a card with the one holder + a Change action. */}
      {SINGLE_SLOTS.map((slot) => {
        const h = holder(slot.role);
        // Reassigning the PM is an Admin action; the PM can't change her own role.
        const editable = slot.role === "Project Manager" ? isAdmin : canManage;
        return (
          <div key={slot.role}>
            <h3 className="mb-2 text-sm font-semibold">{slot.role}</h3>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  {h ? (
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: avatarColor(h.distinctId) }}
                    >
                      {initials(h.name)}
                    </span>
                  ) : (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserPlus className="size-3.5" />
                    </span>
                  )}
                  <span className="font-medium">{h?.name ?? "Unassigned"}</span>
                </div>
                {editable && (
                  <PersonSlotPicker
                    value={h?.distinctId ?? ""}
                    options={poolOptions}
                    onChange={(idv) => setSlot(slot.role, idv, h?.distinctId ?? null)}
                    trigger={
                      <Button size="sm" variant="outline" disabled={busy} className="gap-1">
                        {h ? "Change" : "Assign"}
                        <ChevronDown className="size-3.5 opacity-70" />
                      </Button>
                    }
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Team Members — the open, multi-person role. */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Team Members</h3>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  <UserPlus className="size-4" />
                  Add member
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[60vh] w-64 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Add someone from this customer</DropdownMenuLabel>
                {candidates.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Everyone is already a member.</div>
                )}
                {candidates.map((c) => (
                  <DropdownMenuItem key={c.distinctId} onSelect={() => add(c.distinctId)} className="gap-2">
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: avatarColor(c.distinctId) }}
                    >
                      {initials(c.name)}
                    </span>
                    <span className="text-sm font-medium leading-tight">{c.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {team.length === 0 ? (
          <EmptyState icon={Users} title="No team members" description="Add people to this project." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <tbody>
                {team.map((u) => (
                  <tr key={u.distinctId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                          style={{ backgroundColor: avatarColor(u.distinctId) }}
                        >
                          {initials(u.name)}
                        </span>
                        <span className="font-medium">{u.name}</span>
                      </div>
                    </td>
                    {canManage && (
                      <td className="w-12 px-4 py-3 text-right">
                        <button
                          onClick={() => remove(u.distinctId)}
                          disabled={busy}
                          aria-label={`Remove ${u.name}`}
                          className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Others — object subscribers who aren't formal team members (watchers / CC).
          READ-ONLY: a watcher receives specific CATEGORIES, configured in Notification
          settings (the per-category recipient list), not here. */}
      {others.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Others</h3>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <tbody>
                {others.map((u) => (
                  <tr key={u.distinctId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                          style={{ backgroundColor: avatarColor(u.distinctId) }}
                        >
                          {initials(u.name)}
                        </span>
                        <span className="font-medium">{u.name}</span>
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{u.role || "Watcher"}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Single-occupancy roles, in display order.
const SINGLE_SLOTS = [
  { role: "Project Manager" },
  { role: "Process Owner" },
  { role: "Project Sponsor" },
];

// Roles that have their own section above; anything else (Watcher, blank) → "Others".
const ROLE_BUCKETS = ["Project Manager", "Process Owner", "Project Sponsor", "Team Member"];
