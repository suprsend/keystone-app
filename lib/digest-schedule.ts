// Mapping between the UI digest model (DigestOption, in digest-frequency.tsx) and
// SuprSend's digest_schedule schema (preference_category / tenant / user). Neutral
// module so both server libs and client components can import it. Only a TYPE is
// imported from the client component (erased at build — no client/server bleed).
import type { DigestOption } from "@/components/preferences/digest-frequency";

export interface SsEditable<T> {
  edit_policy: "locked" | "editable";
  default_value: T;
}
export interface SsDigestOption {
  id: string;
  label?: string;
  frequency: string; // instantly|minutely|hourly|daily|weekly|weekly_mo2fr|monthly
  interval?: number;
  weekdays?: SsEditable<string[]>;
  monthdays?: SsEditable<{ pos: number; day?: string }[]>;
  // The API renamed the per-option time field `start_time` → `time` (same shape as
  // the `condition_attributes` → `properties` rename). Read either, write `time`.
  time?: SsEditable<string>;
  start_time?: SsEditable<string>;
  dtstart?: SsEditable<string>;
  is_default?: boolean;
}
export interface SsDigestSchedule {
  enabled: boolean;
  options: SsDigestOption[];
}

// UI display frequency ↔ SuprSend snake frequency.
const FREQ_TO_SNAKE: Record<string, string> = {
  Instant: "instantly",
  Minutely: "minutely",
  Hourly: "hourly",
  Daily: "daily",
  Weekly: "weekly",
  "Weekly (Mon–Fri)": "weekly_mo2fr",
  Monthly: "monthly",
};
const FREQ_FROM_SNAKE: Record<string, string> = Object.fromEntries(
  Object.entries(FREQ_TO_SNAKE).map(([k, v]) => [v, k]),
);

// UI weekday index (0=Sun..6=Sat) ↔ SuprSend 2-letter code.
const DOW_CODES = ["su", "mo", "tu", "we", "th", "fr", "sa"];
const dowToCode = (d: number) => DOW_CODES[d] ?? "su";
const dowFromCode = (c: string) => Math.max(0, DOW_CODES.indexOf(c));
const MON_FRI_CODES = ["mo", "tu", "we", "th", "fr"];

// Monthly: UI ordinal ↔ SuprSend pos; UI unit ↔ weekday code.
const ORDINAL_TO_POS: Record<string, number> = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, Last: -1 };
const POS_TO_ORDINAL: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", [-1]: "Last" };
const UNIT_TO_CODE: Record<string, string> = {
  Monday: "mo",
  Tuesday: "tu",
  Wednesday: "we",
  Thursday: "th",
  Friday: "fr",
  Saturday: "sa",
  Sunday: "su",
};
const CODE_TO_UNIT: Record<string, string> = Object.fromEntries(Object.entries(UNIT_TO_CODE).map(([k, v]) => [v, k]));

// start_time applies to every cadence except Instant and Minutely.
const snakeHasTime = (f: string) => f !== "instantly" && f !== "minutely";

export function ssOptionToDigest(o: SsDigestOption): DigestOption {
  const frequency = FREQ_FROM_SNAKE[o.frequency] ?? "Instant";
  const md = o.monthdays?.default_value?.[0];
  return {
    id: o.id,
    frequency,
    interval: o.interval ?? 1,
    timeMode: (o.time ?? o.start_time)?.edit_policy === "editable" ? "user" : "fixed",
    time: (o.time ?? o.start_time)?.default_value ?? "09:00",
    daysMode: o.weekdays?.edit_policy === "editable" ? "user" : "fixed",
    days: (o.weekdays?.default_value ?? []).map(dowFromCode),
    monthMode: o.monthdays?.edit_policy === "editable" ? "user" : "fixed",
    ordinal: md ? POS_TO_ORDINAL[md.pos] ?? "1st" : "1st",
    unit: md?.day ? CODE_TO_UNIT[md.day] ?? "Day" : "Day",
    isDefault: Boolean(o.is_default),
  };
}

export function digestToSsOption(d: DigestOption): SsDigestOption {
  const frequency = FREQ_TO_SNAKE[d.frequency] ?? "instantly";
  const o: SsDigestOption = { id: d.id, label: d.frequency, frequency, is_default: d.isDefault };
  if (frequency !== "instantly") o.interval = d.interval;
  if (frequency === "weekly") {
    o.weekdays = { edit_policy: d.daysMode === "user" ? "editable" : "locked", default_value: d.days.map(dowToCode) };
  }
  if (frequency === "weekly_mo2fr") {
    o.weekdays = { edit_policy: "locked", default_value: MON_FRI_CODES };
  }
  if (frequency === "monthly") {
    const day = d.unit !== "Day" ? UNIT_TO_CODE[d.unit] : undefined;
    o.monthdays = {
      edit_policy: d.monthMode === "user" ? "editable" : "locked",
      default_value: [{ pos: ORDINAL_TO_POS[d.ordinal] ?? 1, ...(day ? { day } : {}) }],
    };
  }
  if (snakeHasTime(frequency)) {
    // Write the new `time` key (API renamed from `start_time`).
    o.time = { edit_policy: d.timeMode === "user" ? "editable" : "locked", default_value: d.time };
  }
  return o;
}

export const ssScheduleToDigest = (s?: SsDigestSchedule | null): DigestOption[] => (s?.options ?? []).map(ssOptionToDigest);

export const digestToSsSchedule = (opts: DigestOption[]): SsDigestSchedule => ({
  enabled: opts.length > 0,
  options: opts.map(digestToSsOption),
});

// ── User/object level: the digest is a SINGLE resolved pick, not an options array.
// The pick carries the chosen option's fields flattened (start_time/weekdays/
// monthdays are plain values, not { edit_policy, default_value }).
export interface SsUserPick {
  id?: string;
  label?: string;
  frequency?: string;
  interval?: number;
  time?: string; // renamed from start_time at the option level — accept either here too
  start_time?: string;
  weekdays?: string[];
  monthdays?: { pos: number; day?: string }[];
  is_default?: boolean;
  is_user_selected?: boolean;
}

// The user's chosen option → the flattened pick the PATCH expects.
export function digestToUserPick(o: DigestOption): SsUserPick {
  const ss = digestToSsOption(o);
  const pick: SsUserPick = { id: ss.id, frequency: ss.frequency };
  if (ss.interval != null) pick.interval = ss.interval;
  // Source from the (renamed) option time, but keep emitting `start_time` for the
  // user PATCH — no evidence the subscriber endpoint renamed, so don't regress it.
  if (ss.time ?? ss.start_time) pick.start_time = (ss.time ?? ss.start_time)!.default_value;
  if (ss.weekdays) pick.weekdays = ss.weekdays.default_value;
  if (ss.monthdays) pick.monthdays = ss.monthdays.default_value;
  return pick;
}

// A resolved pick → the DigestChoice the user picker renders.
export function userPickToChoice(pick?: SsUserPick | null): { selectedId?: string; time?: string; days?: number[]; ordinal?: string; unit?: string } {
  if (!pick) return {};
  const md = pick.monthdays?.[0];
  return {
    selectedId: pick.id,
    time: typeof (pick.time ?? pick.start_time) === "string" ? (pick.time ?? pick.start_time) : undefined,
    days: Array.isArray(pick.weekdays) ? pick.weekdays.map(dowFromCode) : undefined,
    ordinal: md ? POS_TO_ORDINAL[md.pos] : undefined,
    unit: md?.day ? CODE_TO_UNIT[md.day] : md ? "Day" : undefined,
  };
}
