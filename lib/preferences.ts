// Shared, framework-agnostic helpers for the notification preference tables
// (admin workspace defaults, project/tenant defaults, and the per-user
// preference center). Pure — safe to import from server or client.

/** Channels exposed in the preference tables. The product delivers/tests on these. */
export const PREF_CHANNELS: readonly string[] = ["email", "inbox"];

/** Preference value → human label, shared by the admin preference tables. */
export const PREF_LABEL: Record<string, string> = {
  opt_in: "On",
  opt_out: "Off",
  cant_unsubscribe: "Mandatory",
};

/**
 * Group items under their parent section, preserving the order each section
 * first appears. Shared by every preference table (replaces a copy-pasted
 * find/push loop in four components).
 */
export function groupBySection<T>(
  items: T[],
  getSection: (item: T) => string | null | undefined,
): { section: string; items: T[] }[] {
  const groups: { section: string; items: T[] }[] = [];
  for (const item of items) {
    const section = getSection(item) || "Other";
    let g = groups.find((x) => x.section === section);
    if (!g) {
      g = { section, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  return groups;
}
