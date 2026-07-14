"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ── Digest model ──────────────────────────────────────────────────────────────
// A category's digest schedule is a list of cadence OPTIONS the admin offers. The
// user picks one and may change only the dimensions the admin marked "let users
// set". Each frequency exposes different dimensions (Minutely has no time; Weekly
// has days; Monthly has a day-of-month; etc.). UI only — maps to SuprSend's
// digest_schedule via the API later.
export const DIGEST_FREQUENCIES = ["Instant", "Minutely", "Hourly", "Daily", "Weekly", "Weekly (Mon–Fri)", "Monthly"];

export const WEEKDAYS = [
  { i: 0, short: "S", label: "Sunday" },
  { i: 1, short: "M", label: "Monday" },
  { i: 2, short: "T", label: "Tuesday" },
  { i: 3, short: "W", label: "Wednesday" },
  { i: 4, short: "T", label: "Thursday" },
  { i: 5, short: "F", label: "Friday" },
  { i: 6, short: "S", label: "Saturday" },
];
export const MON_FRI = [1, 2, 3, 4, 5];
export const ORDINALS = ["1st", "2nd", "3rd", "4th", "Last"];
export const MONTH_UNITS = ["Day", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Mode = "fixed" | "user";

export interface DigestOption {
  id: string;
  frequency: string;
  interval: number;
  // Time — used by Hourly (start time), Daily, Weekly, Monthly.
  timeMode: Mode;
  time: string; // "HH:MM"
  // Day(s) of week — used by Weekly.
  daysMode: Mode;
  days: number[];
  // Day of month — used by Monthly (ordinal + unit, e.g. "1st Day").
  monthMode: Mode;
  ordinal: string;
  unit: string;
  isDefault: boolean;
}

// Which dimensions a frequency exposes.
export const freqHasTime = (f: string) => f !== "Instant" && f !== "Minutely";
export const freqHasDays = (f: string) => f === "Weekly";
export const freqHasMonth = (f: string) => f === "Monthly";
export const freqHasInterval = (f: string) => f !== "Instant";

let _idSeq = 0;
export function newDigestOption(partial?: Partial<DigestOption>): DigestOption {
  _idSeq += 1;
  return {
    id: `d${_idSeq}`,
    frequency: "Daily",
    interval: 1,
    timeMode: "user",
    time: "09:00",
    daysMode: "fixed",
    days: [1],
    monthMode: "fixed",
    ordinal: "1st",
    unit: "Day",
    isDefault: false,
    ...partial,
  };
}

// When the admin switches an option's frequency, normalise the dimensions so the
// option always makes sense (e.g. Weekly (Mon–Fri) locks the days to Mon–Fri).
export function normaliseFrequency(o: DigestOption, frequency: string): DigestOption {
  const next = { ...o, frequency };
  if (frequency === "Weekly (Mon–Fri)") {
    next.days = [...MON_FRI];
    next.daysMode = "fixed";
  } else if (frequency === "Weekly" && (o.days.length === 0 || o.frequency === "Weekly (Mon–Fri)")) {
    next.days = [1];
  }
  return next;
}

// The baseline schedule: every cadence offered, Instant the default, digest
// cadences letting users set the time. The admin trims/configures from here.
export function defaultDigestSchedule(): DigestOption[] {
  return DIGEST_FREQUENCIES.map((f, i) =>
    normaliseFrequency(
      newDigestOption({
        frequency: f,
        timeMode: "user",
        time: f === "Instant" ? "" : "09:00",
        isDefault: i === 0,
      }),
      f,
    ),
  );
}

// ── Formatting helpers ────────────────────────────────────────────────────────
export function fmtTime(hhmm: string): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
export function fmtDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && MON_FRI.every((d) => days.includes(d))) return "Mon–Fri";
  return WEEKDAYS.filter((w) => days.includes(w.i))
    .map((w) => w.label.slice(0, 3))
    .join(", ") || "—";
}
export const monthLabel = (o: DigestOption) => `${o.ordinal} ${o.unit}`;

// One-line summary of an option, for the admin cell + user dropdown.
export function digestSummary(o: DigestOption): string {
  if (o.frequency === "Instant") return "Instant";
  if (o.frequency === "Minutely") return o.interval > 1 ? `Every ${o.interval} minutes` : "Every minute";
  const parts: string[] = [o.frequency];
  if (freqHasMonth(o.frequency) && o.monthMode === "fixed") parts.push(monthLabel(o));
  // Show the concrete time whenever one is set (even if the cadence lets users pick it)
  // — once resolved, the chip should display the actual send time, e.g. "Hourly · 6 PM".
  if (freqHasTime(o.frequency) && o.time) parts.push(fmtTime(o.time));
  return parts.join(" · ");
}

// ── User-facing day-of-week chips ─────────────────────────────────────────────
export function DayChips({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange?: (days: number[]) => void;
  disabled?: boolean;
}) {
  const toggle = (i: number) =>
    onChange?.(value.includes(i) ? value.filter((d) => d !== i) : [...value, i].sort((a, b) => a - b));
  return (
    <div className="flex items-center gap-1">
      {WEEKDAYS.map((w, idx) => {
        const on = value.includes(w.i);
        return (
          <button
            key={idx}
            type="button"
            disabled={disabled || !onChange}
            onClick={() => toggle(w.i)}
            aria-label={w.label}
            aria-pressed={on}
            className={cn(
              "flex size-6 items-center justify-center rounded-md border text-[11px] font-medium transition-colors",
              on
                ? "border-[var(--brand-blue)] bg-[var(--brand-blue)] text-white"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
              (disabled || !onChange) && "cursor-default opacity-90",
            )}
          >
            {w.short}
          </button>
        );
      })}
    </div>
  );
}

// ── USER picker ───────────────────────────────────────────────────────────────
// Choose one of the admin's allowed cadences. Each dimension the admin marked
// "let users set" becomes an inline control; fixed dimensions show read-only. The
// row keeps a steady height (min-h-8, single line) so switching cadences doesn't
// shift the layout.
export interface DigestChoice {
  selectedId?: string;
  time?: string;
  days?: number[];
  ordinal?: string;
  unit?: string;
}

// Resolve a pick into the concrete option chosen (the selected option from the
// allowed schedule, with any let-users-set tweaks applied, marked default). Used
// when persisting a tenant/user override.
export function resolveDigestChoice(schedule: DigestOption[], value: DigestChoice): DigestOption | null {
  const selected = schedule.find((o) => o.id === value.selectedId) ?? schedule.find((o) => o.isDefault) ?? schedule[0];
  if (!selected) return null;
  return {
    ...selected,
    time: value.time ?? selected.time,
    days: value.days ?? selected.days,
    ordinal: value.ordinal ?? selected.ordinal,
    unit: value.unit ?? selected.unit,
    isDefault: true,
  };
}

// Compact cell that shows "Digest" + an edit affordance, opening the cadence picker
// in a dialog. The cadence detail stays inside (the cell stays clean); rendered only
// where a digest is actually defined — non-digest categories show "Immediate".
export function DigestPill({
  disabled,
  title = "Digest schedule",
  summary,
  children,
}: {
  disabled?: boolean;
  title?: string;
  // When given, the chip shows the resolved cadence (e.g. "Daily · 6 PM") instead of
  // the generic "Digest" — so the schedule is visible without opening the editor.
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        <span className="whitespace-nowrap">{summary ?? "Digest"}</span>
        <Pencil className="size-3 shrink-0 text-muted-foreground" />
      </button>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function DigestFrequency({
  schedule,
  value,
  disabled,
  onChange,
  onReset,
}: {
  schedule: DigestOption[];
  value: DigestChoice;
  disabled?: boolean;
  onChange: (next: DigestChoice) => void;
  // Clears the project override so the category inherits the workspace default.
  onReset?: () => void;
}) {
  const selected = schedule.find((o) => o.id === value.selectedId) ?? schedule.find((o) => o.isDefault) ?? schedule[0];
  if (!selected) return <span className="text-xs text-muted-foreground">—</span>;
  const defaultOpt = schedule.find((o) => o.isDefault) ?? schedule[0];
  // "Overriding" only when the resolved cadence actually DIFFERS from the default —
  // selecting the same value as the default is not an override.
  const resolvedOpt = resolveDigestChoice(schedule, value);
  const isOverridden = Boolean(resolvedOpt && defaultOpt && digestSummary(resolvedOpt) !== digestSummary(defaultOpt));
  const set = (patch: Partial<DigestChoice>) => onChange({ ...value, selectedId: selected.id, ...patch });
  const days = value.days ?? selected.days;
  const ordinal = value.ordinal ?? selected.ordinal;
  const unit = value.unit ?? selected.unit;
  const time = value.time ?? selected.time;
  const readOnly = "text-xs text-muted-foreground";
  const fieldCls =
    "rounded-md border border-border bg-background px-1.5 py-1 text-xs outline-none focus:border-ring disabled:opacity-50 accent-[var(--brand-blue)] [color-scheme:light]";

  return (
    <div className="flex flex-col gap-1.5">
    <div className="flex min-h-8 items-center gap-2">
      <select
        value={selected.id}
        disabled={disabled}
        onChange={(e) => onChange({ selectedId: e.target.value })}
        className="w-36 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {schedule.map((o) => (
          <option key={o.id} value={o.id}>
            {o.frequency}
          </option>
        ))}
      </select>

      {/* Day(s) of week — Weekly */}
      {freqHasDays(selected.frequency) &&
        (selected.daysMode === "user" ? (
          <DayChips value={days} disabled={disabled} onChange={(d) => set({ days: d })} />
        ) : (
          <span className={readOnly}>{fmtDays(selected.days)}</span>
        ))}
      {selected.frequency === "Weekly (Mon–Fri)" && <span className={readOnly}>Mon–Fri</span>}

      {/* Day of month — Monthly */}
      {freqHasMonth(selected.frequency) &&
        (selected.monthMode === "user" ? (
          <span className="flex items-center gap-1.5 text-xs">
            <select value={ordinal} disabled={disabled} onChange={(e) => set({ ordinal: e.target.value })} className={fieldCls}>
              {ORDINALS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select value={unit} disabled={disabled} onChange={(e) => set({ unit: e.target.value })} className={fieldCls}>
              {MONTH_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <span className={readOnly}>{monthLabel(selected)}</span>
        ))}

      {/* Time — Hourly (start), Daily, Weekly, Monthly */}
      {freqHasTime(selected.frequency) &&
        (selected.timeMode === "user" ? (
          <input
            type="time"
            value={time}
            disabled={disabled}
            onChange={(e) => set({ time: e.target.value })}
            className={fieldCls}
            aria-label="Digest send time"
          />
        ) : selected.time ? (
          <span className={readOnly}>at {fmtTime(selected.time)}</span>
        ) : null)}
    </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>Workspace default: {digestSummary(defaultOpt)}</span>
        {isOverridden && (
          <span className="rounded bg-secondary px-1 py-0.5 font-medium text-secondary-foreground">overriding default</span>
        )}
        {isOverridden && onReset && (
          <button
            type="button"
            disabled={disabled}
            onClick={onReset}
            className="text-[var(--brand-blue)] hover:underline disabled:opacity-50"
          >
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}
