"use client";

import * as React from "react";
import { Plus, X, UserPlus, Search } from "lucide-react";
import { avatarColor, initials } from "@/lib/people";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Recipients {
  roles: string[];
  emails: string[];
}

export interface Candidate {
  distinctId: string;
  name: string;
  email: string | null;
}

// An individually-added recipient ("Other User") is matched purely by distinct_id, so
// no role is asked for — they're subscribed to the project object as a passive Watcher
// just so object fan-out can reach them.
const OTHER_USER_ROLE = "Watcher";

// Recipient roles (as removable pills) plus, in a PROJECT context, an "Other User"
// action: search the WORKSPACE directory (people not already on the project) and add
// one as an always-notify recipient — matched by distinct_id (no role needed). They're
// subscribed to the project object as a passive Watcher so object fan-out reaches them.
// This never invents a new user — it picks an existing org member, JIRA-style.
// `candidates` + `onAddMember` are only passed in the project view; at the workspace
// level the cell is roles-only.
export function RecipientCell({
  roles,
  roleOptions,
  extraRoles,
  emails,
  editable,
  onChange,
  candidates,
  onAddMember,
  members,
  onRemoveMember,
}: {
  roles: string[];
  /** Roles that can be added — the workspace's live role options. */
  roleOptions: string[];
  /** Roles from `recip:` tags outside the role options (added in the SuprSend
   *  dashboard). Shown as read-only pills — the app never edits or removes them. */
  extraRoles?: string[];
  emails: string[];
  editable: boolean;
  onChange: (next: Recipients) => void;
  candidates?: Candidate[];
  onAddMember?: (distinctId: string, role: string) => void | Promise<void>;
  /** Individually-added project members (e.g. Watchers) shown as removable pills. */
  members?: Candidate[];
  onRemoveMember?: (distinctId: string) => void | Promise<void>;
}) {
  const [searching, setSearching] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const available = roleOptions.filter((r) => !roles.includes(r));
  const canAddOther = Boolean(onAddMember && candidates);
  const q = query.trim().toLowerCase();
  const filtered = (candidates ?? []).filter(
    (c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q),
  );

  async function add(distinctId: string) {
    if (!onAddMember) return;
    setBusy(true);
    try {
      await onAddMember(distinctId, OTHER_USER_ROLE);
      setSearching(false);
      setQuery("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {roles.length === 0 && (extraRoles ?? []).length === 0 && emails.length === 0 && (members ?? []).length === 0 && (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        {(members ?? []).map((m) => (
          <span
            key={m.distinctId}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-2 text-xs"
            title={m.email ?? m.name}
          >
            <span
              className="flex size-4 items-center justify-center rounded-full text-[8px] font-medium text-white"
              style={{ backgroundColor: avatarColor(m.distinctId) }}
            >
              {initials(m.name)}
            </span>
            {m.name}
            {editable && onRemoveMember && (
              <button
                onClick={() => onRemoveMember(m.distinctId)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${m.name} from the project`}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {(extraRoles ?? []).map((r) => (
          <span
            key={`extra:${r}`}
            className="inline-flex items-center rounded-full border border-dashed border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
            title="Managed in the SuprSend dashboard — this app only displays it."
          >
            {r}
          </span>
        ))}
        {roles.map((r) => (
          <span key={r} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
            {r}
            {editable && (
              <button
                onClick={() => onChange({ roles: roles.filter((x) => x !== r), emails })}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${r}`}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {emails.map((email) => {
          // Show the person, not the raw email: resolve to a name (from the project
          // members / workspace directory) and render initials like the other people pills.
          const person = [...(members ?? []), ...(candidates ?? [])].find(
            (c) => (c.email ?? "").toLowerCase() === email.toLowerCase(),
          );
          const name = person?.name ?? email.split("@")[0].replace(/[._]+/g, " ");
          return (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-2 text-xs"
              title={email}
            >
              <span
                className="flex size-4 items-center justify-center rounded-full text-[8px] font-medium text-white"
                style={{ backgroundColor: avatarColor(email) }}
              >
                {initials(name)}
              </span>
              {name}
              {editable && (
                <button
                  onClick={() => onChange({ roles, emails: emails.filter((e) => e !== email) })}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${name}`}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          );
        })}
        {editable && (available.length > 0 || canAddOther) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Add recipient"
            >
              <Plus className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {available.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground">Role</DropdownMenuLabel>
                  {available.map((r) => (
                    <DropdownMenuItem key={r} onSelect={() => onChange({ roles: [...roles, r], emails })}>
                      {r}
                    </DropdownMenuItem>
                  ))}
                  {canAddOther && <DropdownMenuSeparator />}
                </>
              )}
              {canAddOther && (
                <DropdownMenuItem
                  onSelect={() => {
                    setSearching(true);
                    setQuery("");
                  }}
                  className="gap-2"
                >
                  <UserPlus className="size-4 text-muted-foreground" />
                  Other User…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {editable && searching && canAddOther && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg">
          <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border px-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearching(false)}
              placeholder="Search name or email"
              className="h-7 flex-1 bg-transparent text-xs outline-none"
            />
            <button onClick={() => setSearching(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-1.5 py-2 text-xs text-muted-foreground">No matching users.</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.distinctId}
                  disabled={busy}
                  onClick={() => add(c.distinctId)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white"
                    style={{ backgroundColor: avatarColor(c.distinctId) }}
                  >
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
