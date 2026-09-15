"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, ListTodo, MessageSquare, Wallet, Pencil } from "lucide-react";
import { useAppState } from "@/components/providers";
import { avatarColor, initials } from "@/lib/people";
import { PROCESS_OWNER, PROJECT_MANAGER } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TASK_STATUSES = ["In progress", "Completed"];

interface Task {
  id: string;
  name: string;
  assigneeId: string;
  status: string;
  dueDate: string;
}
interface Member {
  distinctId: string;
  name: string;
  role: string;
}
interface Comment {
  id: string;
  authorId: string;
  body: string;
  at: string;
  mentionId?: string;
}

// Project Overview — the project's real content: a comment thread and the task table,
// both full width. (Total cost is a single scalar, so it lives inline in the project
// header — see ProjectCostField.) Comments and tasks live on the project OBJECT and
// drive the Comment Added / Task Completed / Tasks Coming Up workflows.
export function ProjectOverview({ id }: { id: string }) {
  const { actorId, actorRole } = useAppState();
  const canManage = actorRole === "Admin" || actorRole === PROJECT_MANAGER;
  return (
    <div className="space-y-6">
      <CommentsPanel tenant={id} actorId={actorId} />
      <TasksPanel tenant={id} actorId={actorId} canManage={canManage} />
    </div>
  );
}

/* ── Total cost — a single number on the project OBJECT. It is what the Project
   Started / Paused notifications compare against the category's `Cost > N` threshold:
   below the threshold those notifications do not send. Editable by Admin / PM.

   Rendered INLINE in the project header, not as a card: it's one scalar value, so a
   full panel (with a permanently-open, usually-empty input) both overweights it and
   reads badly. Shows the value as text; managers click the pencil to edit. ── */
export function ProjectCostField({ tenant, canManage }: { tenant: string; canManage: boolean }) {
  const [cost, setCost] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch(`/api/admin/project-cost?tenant=${encodeURIComponent(tenant)}`, { cache: "no-store" });
        const d = await r.json();
        if (active && d.ok) {
          setCost(d.cost ?? null);
          setDraft(d.cost === null || d.cost === undefined ? "" : String(d.cost));
        }
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [tenant]);

  const save = async () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0) {
      toast.error("Enter a non-negative number.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/project-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant, cost: n }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) {
        toast.error("Couldn’t save cost", { description: d.error });
        return;
      }
      setCost(n);
      setEditing(false);
      toast.success("Project cost saved.");
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setBusy(false);
    }
  };

  const dirty = draft.trim() !== "" && Number(draft) !== cost;

  if (!loaded) return <Skeleton className="h-5 w-28 rounded" />;

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="relative w-28">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input
            type="number"
            min={0}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) save();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="50000"
            className="h-8 pl-5 text-sm"
          />
        </span>
        <Button size="sm" className="h-8" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Wallet className="size-3.5" />
      Total cost:
      <span className={cn("font-medium", cost === null ? "text-muted-foreground" : "text-foreground")}>
        {cost === null ? "Not set" : `$${cost.toLocaleString("en-US")} USD`}
      </span>
      {canManage && (
        <button
          type="button"
          aria-label="Edit total cost"
          onClick={() => {
            setDraft(cost === null ? "" : String(cost));
            setEditing(true);
          }}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </span>
  );
}

/* ── Comments — LinkedIn-style thread, stored on the object. Typing "@" opens a
   person picker; a comment with a mention fires Tagged (not Comment Added). ── */
function CommentsPanel({ tenant, actorId }: { tenant: string; actorId: string }) {
  const [comments, setComments] = React.useState<Comment[] | null>(null);
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [members, setMembers] = React.useState<{ distinctId: string; name: string }[]>([]);
  const [text, setText] = React.useState("");
  const [mention, setMention] = React.useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = React.useState<string | null>(null); // non-null = picker open
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/project-comments?tenant=${encodeURIComponent(tenant)}`, { cache: "no-store" });
      const d = await r.json();
      if (d.ok) {
        setComments(d.comments);
        setNames(d.names ?? {});
        setMembers(d.members ?? []);
      } else setComments([]);
    } catch {
      setComments([]);
    }
  }, [tenant]);

  React.useEffect(() => {
    // load() only setState's after `await fetch` (not synchronously) — safe here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const onChange = (val: string) => {
    setText(val);
    const m = val.match(/@(\w*)$/); // an @token at the caret (end of text)
    setQuery(m ? m[1].toLowerCase() : null);
  };

  const pickMention = (person: { distinctId: string; name: string }) => {
    setText((t) => t.replace(/@(\w*)$/, `@${person.name} `));
    setMention({ id: person.distinctId, name: person.name });
    setQuery(null);
  };

  const post = async () => {
    const body = text.trim();
    if (!body) return;
    // Only treat as a mention if the chosen name is still in the text.
    const mentionId = mention && text.includes(`@${mention.name}`) ? mention.id : undefined;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/project-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant, body, mentionId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) {
        toast.error("Couldn’t post comment", { description: d.error });
        return;
      }
      setText("");
      setMention(null);
      if (d.tagged) toast.success(`${mention?.name ?? "Person"} tagged — they were notified.`);
      else if (d.notified > 0) toast.success(`Comment posted — ${d.notified} team member${d.notified > 1 ? "s" : ""} notified.`);
      else toast.success("Comment posted.");
      await load();
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setBusy(false);
    }
  };

  const picks =
    query === null
      ? []
      : members.filter((m) => m.distinctId !== actorId && m.name.toLowerCase().includes(query)).slice(0, 6);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <MessageSquare className="size-4 text-muted-foreground" /> Comments
      </h3>
      <div className="mb-4 flex flex-col gap-2">
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Write a comment…  (type @ to tag someone)"
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none"
          />
          {query !== null && picks.length > 0 && (
            <div className="absolute left-2 top-full z-10 mt-1 w-60 overflow-hidden rounded-md border border-border bg-popover shadow-md">
              {picks.map((p) => (
                <button
                  key={p.distinctId}
                  type="button"
                  onClick={() => pickMention(p)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: avatarColor(p.distinctId) }}
                  >
                    {initials(p.name)}
                  </span>
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={post} disabled={busy || !text.trim()}>
            Comment
          </Button>
        </div>
      </div>
      <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
        {comments === null ? (
          [0, 1].map((i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)
        ) : comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          [...comments].reverse().map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ backgroundColor: avatarColor(c.authorId) }}
              >
                {initials(names[c.authorId] ?? c.authorId)}
              </span>
              <div className="min-w-0 flex-1 rounded-lg bg-muted/50 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{names[c.authorId] ?? c.authorId}</span>
                  <span className="text-[11px] text-muted-foreground">{fmtTime(c.at)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
                  <MentionBody body={c.body} mentionName={c.mentionId ? names[c.mentionId] : undefined} />
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Tasks — table on the object; status drives Task Completed, add drives Tasks Coming Up ── */
function TasksPanel({ tenant, actorId, canManage }: { tenant: string; actorId: string; canManage: boolean }) {
  const [tasks, setTasks] = React.useState<Task[] | null>(null);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [mineOnly, setMineOnly] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/project-tasks?tenant=${encodeURIComponent(tenant)}`, { cache: "no-store" });
      const d = await r.json();
      if (d.ok) {
        setTasks(d.tasks);
        setMembers(d.members ?? []);
      } else setTasks([]);
    } catch {
      setTasks([]);
    }
  }, [tenant]);

  React.useEffect(() => {
    // load() only setState's after `await fetch` (not synchronously) — safe here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const nameOf = (id: string) => members.find((m) => m.distinctId === id)?.name ?? id;
  const pmId = members.find((m) => m.role === PROJECT_MANAGER)?.distinctId;
  const isPm = actorId === pmId;
  // A task can be assigned to anyone on the project except the Process Owner.
  const assignable = members.filter((m) => m.role !== PROCESS_OWNER);

  const setStatus = async (taskId: string, status: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/project-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant, taskId, status }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) {
        toast.error("Couldn’t update task", { description: d.error });
        return;
      }
      if (status === "Completed") toast.success("Task completed — PM notified.");
      await load();
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setBusy(false);
    }
  };

  const shown = (tasks ?? []).filter((t) => !mineOnly || t.assigneeId === actorId);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ListTodo className="size-4 text-muted-foreground" /> Tasks
        </h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} className="accent-[var(--brand-blue)]" />
            My tasks
          </label>
          {canManage && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add task
            </Button>
          )}
        </div>
      </div>

      <AddTaskDialog
        key={addOpen ? "open" : "closed"}
        open={addOpen}
        onOpenChange={setAddOpen}
        assignable={assignable}
        tenant={tenant}
        busy={busy}
        setBusy={setBusy}
        onAdded={load}
      />

      {tasks === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Task</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {mineOnly ? "No tasks assigned to you." : "No tasks yet."}
                  </td>
                </tr>
              ) : (
                shown.map((t) => {
                  const canEdit = canManage || isPm || t.assigneeId === actorId;
                  return (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">{t.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            style={{ backgroundColor: avatarColor(t.assigneeId) }}
                          >
                            {initials(nameOf(t.assigneeId))}
                          </span>
                          <span>{nameOf(t.assigneeId)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {canEdit ? (
                          <select
                            value={t.status}
                            disabled={busy}
                            onChange={(e) => setStatus(t.id, e.target.value)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-ring focus:outline-none disabled:opacity-50"
                          >
                            {TASK_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
                              t.status === "Completed"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-border bg-background text-muted-foreground",
                            )}
                          >
                            {t.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(t.dueDate)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddTaskDialog({
  open,
  onOpenChange,
  assignable,
  tenant,
  busy,
  setBusy,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assignable: Member[];
  tenant: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onAdded: () => Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState(assignable[0]?.distinctId ?? "");
  const [dueDate, setDueDate] = React.useState("");

  const submit = async () => {
    if (!name.trim() || !assigneeId || !dueDate) {
      toast.error("Task, user and due date are required.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/project-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant, name: name.trim(), assigneeId, dueDate }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) {
        toast.error("Couldn’t add task", { description: d.error });
        return;
      }
      toast.success("Task added — reminder scheduled before the due date.");
      await onAdded();
      onOpenChange(false);
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
          <DialogDescription>Scheduling a task fires the Tasks Coming Up reminder before its due date.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="t-name">Task</Label>
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Finalize sensor spec" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-user">User</Label>
            <select
              id="t-user"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm focus:border-ring focus:outline-none"
            >
              {assignable.map((m) => (
                <option key={m.distinctId} value={m.distinctId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-due">Due date</Label>
            <Input id="t-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim() || !assigneeId || !dueDate}>
            {busy ? "Adding…" : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Render a comment body, highlighting the @mentioned name in brand blue.
function MentionBody({ body, mentionName }: { body: string; mentionName?: string }) {
  const token = mentionName ? `@${mentionName}` : "";
  if (!token || !body.includes(token)) return <>{body}</>;
  const parts = body.split(token);
  return (
    <>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {p}
          {i < parts.length - 1 && <span className="font-medium text-[var(--brand-blue)]">{token}</span>}
        </React.Fragment>
      ))}
    </>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}
