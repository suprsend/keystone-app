// Avatar helpers for people. The people themselves are SuprSend users, read live.

const PALETTE = ["#0072CE", "#C8102E", "#7C3AED", "#ED7902", "#0A8080", "#B45309"];

/** Stable avatar colour for a person id. */
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
