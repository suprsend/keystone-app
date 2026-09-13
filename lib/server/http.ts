import "server-only";

/** Normalize an unknown thrown value to a message string. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Template and workflow slugs are interpolated into Management API URL paths, so a
 * value containing "/" or ".." could escape the intended endpoint. Slugs created in
 * the SuprSend dashboard may carry underscores or uppercase letters (this repo's own
 * assets are lowercase kebab-case), so allow the full path-safe set: letters, digits,
 * hyphens and underscores.
 */
export function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
}

export const INVALID_SLUG = "Invalid slug — use letters, digits, hyphens and underscores.";
