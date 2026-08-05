import "server-only";

/** Normalize an unknown thrown value to a message string. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Template and workflow slugs are interpolated into Management API URL paths, so a
 * value containing "/" or ".." could escape the intended endpoint. Every real slug is
 * lowercase kebab-case — reject anything else before it reaches the API.
 */
export function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]+$/.test(value);
}

export const INVALID_SLUG = "Invalid slug — use lowercase letters, digits and hyphens.";
