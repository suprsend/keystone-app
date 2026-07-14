"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useAppState } from "@/components/providers";

interface Project {
  tenantId: string;
  label: string;
  members: { id: string; name: string; role: string }[];
}

// "Search projects" — a live dropdown scoped to what the viewer can access: an Admin
// sees every project in the customer; anyone else sees only the projects they belong
// to (others aren't shown at all — the standard PM-tool model). Click → that project.
export function SearchProjects() {
  const router = useRouter();
  const { workspace, actorId, actorRole } = useAppState();
  const isAdmin = actorRole === "Admin";
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/people", { cache: "no-store" });
        const d = await res.json();
        if (alive && d.ok) setProjects(d.projects as Project[]);
      } catch {
        /* leave empty */
      }
    })();
    return () => {
      alive = false;
    };
  }, [workspace]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const accessible = isAdmin ? projects : projects.filter((p) => p.members.some((m) => m.id === actorId));
  const query = q.trim().toLowerCase();
  const results = (query ? accessible.filter((p) => p.label.toLowerCase().includes(query)) : accessible).slice(0, 8);

  function goto(id: string) {
    setOpen(false);
    setQ("");
    router.push(`/project/${id}`);
  }

  return (
    <div ref={ref} className="relative hidden md:block">
      <div className="flex items-center rounded-md border border-border bg-background pl-2 text-sm">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) goto(results[0].tenantId);
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search projects"
          className="h-8 w-44 bg-transparent px-2 text-[13px] outline-none placeholder:text-muted-foreground"
          aria-label="Search projects"
        />
      </div>
      {open && (
        <div className="absolute right-0 top-9 z-30 max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No projects found.</div>
          ) : (
            results.map((p) => (
              <button
                key={p.tenantId}
                onClick={() => goto(p.tenantId)}
                className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">{p.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
