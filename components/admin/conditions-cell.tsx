"use client";

import * as React from "react";
import { Plus, X, Lock, Pencil } from "lucide-react";

// A preference condition gates delivery on a metric the workflow compares against
// (e.g. the workflow sends only when Cost is exceeded). The COMPARISON (>) lives in
// the notification's workflow and is NOT shown here — to a tenant this is just a
// property with a value. This cell only sets the metric's VALUE and whether
// tenants/users may change it (edit_policy locked/editable) — exactly what
// SuprSend's condition_attributes store.
export interface Condition {
  key: string; // condition_attribute key, e.g. "cost"
  label: string; // display name, e.g. "Cost"
  value: number; // the threshold the workflow compares against
  editable: boolean; // edit_policy: can a tenant/user change the value?
}

// Metrics the admin can gate on. "Cost Exceeded" mirrors the staging integer
// attribute (key stays "cost"); kept as a list so more can be added without
// touching the cell.
const METRICS = [{ key: "cost", label: "Cost Exceeded" }];

// The label shown for a metric key — so the column reads "Cost Exceeded" even if a
// stored attribute still carries the old SuprSend label; falls back to the data.
const labelFor = (key: string, fallback: string) =>
  METRICS.find((m) => m.key === key)?.label ?? fallback;

export function ConditionsCell({
  conditions,
  editable,
  canAuthor = true,
  onChange,
}: {
  conditions: Condition[];
  editable: boolean;
  // When false, ADJUST-ONLY: the value can be edited, but conditions can't be
  // added or removed (the set is defined by Wellspring in SuprSend).
  canAuthor?: boolean;
  onChange: (next: Condition[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [metric, setMetric] = React.useState(METRICS[0].key);
  const [value, setValue] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function add() {
    const n = Number(value);
    const m = METRICS.find((x) => x.key === metric);
    if (!m || value.trim() === "" || Number.isNaN(n)) return;
    // Replace any existing condition on the same metric, else append.
    const rest = conditions.filter((c) => c.key !== m.key);
    onChange([...rest, { key: m.key, label: m.label, value: n, editable: true }]);
    setValue("");
    setOpen(false);
  }

  return (
    <div className="relative flex flex-wrap items-center gap-1.5" ref={ref}>
      {conditions.length === 0 && (!editable || !canAuthor) && <span className="text-xs text-muted-foreground">—</span>}
      {conditions.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs"
          title={c.editable ? "Click to edit · tenants/users can change this value" : "Click to edit · fixed for tenants/users"}
        >
          {editable ? (
            <button
              type="button"
              onClick={() => {
                setMetric(c.key);
                setValue(String(c.value));
                setOpen(true);
              }}
              className="inline-flex items-center gap-1 hover:underline"
            >
              {labelFor(c.key, c.label)}: {c.value}
              <Pencil className="size-3 text-muted-foreground" />
            </button>
          ) : (
            <span>
              {labelFor(c.key, c.label)}: {c.value}
            </span>
          )}
          {!c.editable && <Lock className="size-2.5 text-muted-foreground" />}
          {editable && canAuthor && (
            <button
              onClick={() => onChange(conditions.filter((x) => x.key !== c.key))}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${c.label} condition`}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {editable && canAuthor && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Add condition"
        >
          <Plus className="size-3.5" />
        </button>
      )}
      {open && (
        <div className="absolute right-0 top-7 z-20 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="mb-2 text-xs font-medium">Add condition</div>
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
              Metric
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground outline-none focus:border-ring"
              >
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-24 flex-col gap-1 text-[11px] text-muted-foreground">
              Value
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") add();
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="0"
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground outline-none focus:border-ring"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="h-7 rounded-md px-2.5 text-xs text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button onClick={add} className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
