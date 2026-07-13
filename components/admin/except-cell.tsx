"use client";

import * as React from "react";
import { Plus, X, Search } from "lucide-react";
import { avatarColor, initials } from "@/lib/people";

export interface ExceptPerson {
  distinctId: string;
  name: string;
  email?: string | null;
}

// "Except" — specific PEOPLE excluded from a notification, on top of the role-based
// recipients. Recipients are dynamic (the holder of a role can change); Except pins
// a person OUT by distinct_id regardless of role, so they never receive it even if
// they later take on a targeted role (e.g. exclude Dana now → she's still excluded
// if she becomes PM later). Shown as initial-avatars (e.g. "DC"). The add control
// mirrors the Recipients "Other User" picker: a search popover over the same roster.
export function ExceptCell({
  excluded,
  members,
  editable,
  onChange,
}: {
  excluded: ExceptPerson[];
  members: ExceptPerson[];
  editable: boolean;
  onChange: (next: ExceptPerson[]) => void;
}) {
  const [searching, setSearching] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const excludedIds = new Set(excluded.map((p) => p.distinctId));
  const q = query.trim().toLowerCase();
  const candidates = members
    .filter((m) => !excludedIds.has(m.distinctId))
    .filter((m) => m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q));

  function add(person: ExceptPerson) {
    onChange([...excluded, person]);
    setQuery("");
  }

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {excluded.length === 0 && !editable && <span className="text-xs text-muted-foreground">—</span>}
      {excluded.map((p) => (
        <span key={p.distinctId} className="group relative inline-flex" title={p.name}>
          <span
            className="flex size-7 items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-background"
            style={{ backgroundColor: avatarColor(p.distinctId) }}
          >
            {initials(p.name)}
          </span>
          {editable && (
            <button
              onClick={() => onChange(excluded.filter((x) => x.distinctId !== p.distinctId))}
              className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
              aria-label={`Stop excluding ${p.name}`}
            >
              <X className="size-2.5" />
            </button>
          )}
        </span>
      ))}

      {editable && (
        <button
          onClick={() => {
            setSearching((s) => !s);
            setQuery("");
          }}
          className="flex size-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Add person to exclude"
        >
          <Plus className="size-3.5" />
        </button>
      )}

      {editable && searching && (
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
            {candidates.length === 0 ? (
              <div className="px-1.5 py-2 text-xs text-muted-foreground">No matching users.</div>
            ) : (
              candidates.map((m) => (
                <button
                  key={m.distinctId}
                  onClick={() => add(m)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white"
                    style={{ backgroundColor: avatarColor(m.distinctId) }}
                  >
                    {initials(m.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
