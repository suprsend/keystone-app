"use client";

import * as React from "react";
import { Plus, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DIGEST_FREQUENCIES,
  ORDINALS,
  MONTH_UNITS,
  type DigestOption,
  newDigestOption,
  normaliseFrequency,
  freqHasInterval,
  freqHasTime,
  freqHasDays,
  freqHasMonth,
  DayChips,
} from "@/components/preferences/digest-frequency";
import { cn } from "@/lib/utils";

// ADMIN digest control: a compact cell showing the default cadence, opening an
// editor to manage the category's allowed cadence options. Each frequency exposes
// only the dimensions that make sense (Minutely has no time; Weekly has days;
// Monthly a day-of-month), and each dimension is either FIXED by the admin or LEFT
// for each user. The user's picker then offers exactly these options. UI only —
// maps to SuprSend's digest_schedule via the API later.
export function DigestCell({
  enabled,
  schedule,
  disabled,
  canAuthor = true,
  onChange,
}: {
  enabled: boolean;
  schedule: DigestOption[];
  disabled?: boolean;
  // When false, the editor is ADJUST-ONLY: no enable toggle, no add/remove option
  // (digest is defined by Keystone in SuprSend; the customer only tunes values).
  canAuthor?: boolean;
  onChange: (enabled: boolean, options: DigestOption[]) => void;
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
        {/* The cadence detail lives inside the editor — outside we only signal that a
            digest is active + that it's editable, to keep the column clean. */}
        {enabled ? (
          <>
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            <span>Digest</span>
          </>
        ) : (
          <span className="text-muted-foreground">Immediate</span>
        )}
        <Pencil className="size-3 text-muted-foreground" />
      </button>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Digest schedule</DialogTitle>
        </DialogHeader>
        <Editor
          enabled={enabled}
          canAuthor={canAuthor}
          schedule={schedule}
          onSave={(en, next) => {
            onChange(en, next);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

// Fixed / Let users set radio pair for a single dimension.
function ModeRadio({
  name,
  mode,
  onChange,
}: {
  name: string;
  mode: "fixed" | "user";
  onChange: (m: "fixed" | "user") => void;
}) {
  return (
    <div className="flex items-center gap-4 text-xs">
      <label className="flex items-center gap-1.5">
        <input
          type="radio"
          name={name}
          checked={mode === "fixed"}
          onChange={() => onChange("fixed")}
          className="accent-[var(--brand-blue)]"
        />
        Fixed
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="radio"
          name={name}
          checked={mode === "user"}
          onChange={() => onChange("user")}
          className="accent-[var(--brand-blue)]"
        />
        Let users set
      </label>
    </div>
  );
}

const sectionCls = "mt-3 rounded-lg bg-muted/40 p-3";
const labelCls = "mb-1.5 text-xs font-medium text-foreground";
const noteCls = "mt-1.5 text-[11px] text-muted-foreground";
const fieldCls = "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring accent-[var(--brand-blue)] [color-scheme:light]";

function Editor({
  enabled,
  canAuthor = true,
  schedule,
  onSave,
  onCancel,
}: {
  enabled: boolean;
  canAuthor?: boolean;
  schedule: DigestOption[];
  onSave: (enabled: boolean, next: DigestOption[]) => void;
  onCancel: () => void;
}) {
  const [on, setOn] = React.useState(enabled);
  const [opts, setOpts] = React.useState<DigestOption[]>(() => schedule.map((o) => ({ ...o })));

  const patch = (id: string, p: Partial<DigestOption>) =>
    setOpts((arr) => arr.map((o) => (o.id === id ? { ...o, ...p } : o)));
  const setFrequency = (id: string, frequency: string) =>
    setOpts((arr) => arr.map((o) => (o.id === id ? normaliseFrequency(o, frequency) : o)));
  const setDefault = (id: string) => setOpts((arr) => arr.map((o) => ({ ...o, isDefault: o.id === id })));
  const add = () => setOpts((arr) => [...arr, newDigestOption({ frequency: "Daily" })]);
  const remove = (id: string) =>
    setOpts((arr) => {
      const left = arr.filter((o) => o.id !== id).map((o) => ({ ...o }));
      if (left.length && !left.some((o) => o.isDefault)) left[0].isDefault = true;
      return left;
    });

  return (
    <>
      {/* Enable / disable digest for this category (digest_schedule.enabled). Only
          shown when authoring (Keystone); the customer view is adjust-only. */}
      {canAuthor && (
        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
          <div>
            <div className="text-sm font-medium">Digest schedule</div>
            <div className="text-[11px] text-muted-foreground">
              {on ? "Batch notifications on a schedule." : "Off — notifications are sent immediately."}
            </div>
          </div>
          <Switch checked={on} onCheckedChange={setOn} aria-label="Enable digest schedule" />
        </div>
      )}
      {on && (
      <div className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
        {opts.map((o) => (
          <div key={o.id} className="rounded-lg border border-border p-3">
            {/* Frequency · Interval · default · remove */}
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
                Frequency
                <select value={o.frequency} onChange={(e) => setFrequency(o.id, e.target.value)} className={fieldCls}>
                  {DIGEST_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              {freqHasInterval(o.frequency) && (
                <label className="flex w-16 flex-col gap-1 text-[11px] text-muted-foreground">
                  Interval
                  <input
                    type="number"
                    min={1}
                    value={o.interval}
                    onChange={(e) => patch(o.id, { interval: Math.max(1, Number(e.target.value) || 1) })}
                    className={fieldCls}
                  />
                </label>
              )}
              {o.isDefault ? (
                <span className="inline-flex h-8 items-center rounded-md bg-[var(--brand-blue-soft)] px-2 text-[11px] font-medium text-[var(--brand-blue)]">
                  Default
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setDefault(o.id)}
                  className="h-8 rounded-md border border-dashed border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Set as default
                </button>
              )}
              {canAuthor && opts.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(o.id)}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  aria-label="Remove option"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* Day(s) of week — Weekly */}
            {freqHasDays(o.frequency) && (
              <div className={sectionCls}>
                <div className={labelCls}>Day of week</div>
                <ModeRadio name={`dw-${o.id}`} mode={o.daysMode} onChange={(m) => patch(o.id, { daysMode: m })} />
                {o.daysMode === "fixed" ? (
                  <>
                    <div className="mt-2">
                      <DayChips value={o.days} onChange={(d) => patch(o.id, { days: d })} />
                    </div>
                    <div className={noteCls}>Fixed — recipients can’t change this.</div>
                  </>
                ) : (
                  <div className={noteCls}>Each recipient picks the day(s).</div>
                )}
              </div>
            )}

            {/* Weekly (Mon–Fri): days locked */}
            {o.frequency === "Weekly (Mon–Fri)" && (
              <div className={sectionCls}>
                <div className={labelCls}>Day of week</div>
                <DayChips value={o.days} />
                <div className={noteCls}>Locked to Mon–Fri for this cadence.</div>
              </div>
            )}

            {/* Day of month — Monthly */}
            {freqHasMonth(o.frequency) && (
              <div className={sectionCls}>
                <div className={labelCls}>Day of month</div>
                <ModeRadio name={`dm-${o.id}`} mode={o.monthMode} onChange={(m) => patch(o.id, { monthMode: m })} />
                {o.monthMode === "fixed" ? (
                  <>
                    <div className="mt-2 flex items-center gap-1.5 text-xs">
                      <select value={o.ordinal} onChange={(e) => patch(o.id, { ordinal: e.target.value })} className={fieldCls}>
                        {ORDINALS.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                      <select value={o.unit} onChange={(e) => patch(o.id, { unit: e.target.value })} className={fieldCls}>
                        {MONTH_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">of month</span>
                    </div>
                    <div className={noteCls}>Fixed for all users.</div>
                  </>
                ) : (
                  <div className={noteCls}>Each recipient picks the day of month.</div>
                )}
              </div>
            )}

            {/* Time — Hourly (start), Daily, Weekly, Monthly */}
            {freqHasTime(o.frequency) && (
              <div className={sectionCls}>
                <div className={labelCls}>{o.frequency === "Hourly" ? "Start time" : "Time"}</div>
                <ModeRadio name={`tm-${o.id}`} mode={o.timeMode} onChange={(m) => patch(o.id, { timeMode: m })} />
                {o.timeMode === "fixed" ? (
                  <>
                    <div className="mt-2">
                      <input
                        type="time"
                        value={o.time}
                        onChange={(e) => patch(o.id, { time: e.target.value })}
                        className={cn(fieldCls, "w-28")}
                      />
                    </div>
                    <div className={noteCls}>
                      {o.frequency === "Hourly"
                        ? "Intervals are counted from this time."
                        : "Fixed — recipients can’t change this."}
                    </div>
                  </>
                ) : (
                  <div className={noteCls}>Each recipient picks their own send time.</div>
                )}
              </div>
            )}
          </div>
        ))}
        {canAuthor && (
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" /> Add option
          </button>
        )}
      </div>
      )}
      <DialogFooter>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(on, opts)}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
