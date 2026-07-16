// Safe test-email policy (single source of truth).
//
// Every demo / test address plus-addresses to ONE inbox, so notifications are testable
// but never reach real people. The default domain is `example.com` (RFC 2606 reserved
// — it never delivers to anyone). To actually RECEIVE test sends, point it at your own
// tester via env:
//   SAFE_TEST_EMAIL_USER    local part before the "+"   (default "demo")
//   SAFE_TEST_EMAIL_DOMAIN  mail domain                 (default "example.com")
//
// NEVER use a real company domain or a bare name@domain (those reach real people) —
// only `<user>+<local>@<domain>`. A provided address is accepted only if it already
// matches that form; otherwise it's rejected.

const USER = process.env.SAFE_TEST_EMAIL_USER || "demo";
const DOMAIN = process.env.SAFE_TEST_EMAIL_DOMAIN || "example.com";

/** A plus-addressed safe address, e.g. `testEmail("dana.carter")` → `demo+dana.carter@example.com`. */
export function testEmail(local: string): string {
  return `${USER}+${local}@${DOMAIN}`;
}

const SAFE_RE = new RegExp(`^${USER}\\+[a-z0-9._%+-]+@${DOMAIN.replace(/\./g, "\\.")}$`, "i");

/** Human hint shown when a provided email is rejected. */
export const SAFE_EMAIL_HINT = `Email must be a safe test address: ${USER}+<name>@${DOMAIN} (no real domains).`;

/**
 * Resolve an email to a guaranteed-safe test address. A provided address is accepted
 * only if it already matches the safe pattern; blank → derive one from the name.
 */
export function safeEmail(
  input: string | undefined,
  name: string,
): { ok: true; email: string } | { ok: false; error: string } {
  const provided = (input ?? "").trim();
  if (provided) {
    if (SAFE_RE.test(provided)) return { ok: true, email: provided.toLowerCase() };
    return { ok: false, error: SAFE_EMAIL_HINT };
  }
  const local = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "");
  if (!local) return { ok: false, error: "Name required to derive an email." };
  return { ok: true, email: testEmail(local) };
}
