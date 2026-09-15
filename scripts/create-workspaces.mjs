// Keystone setup — creates the customer WORKSPACES from an account service token and
// writes a labelled placeholder to .env.local for each credential you then paste from
// the dashboard (Developers → API Keys).
// Run: npm run create-workspaces [-- --dry-run]
//
// This is the only setup script. The design-time ASSETS (templates, workflows,
// preference categories) live as plain files in suprsend/ and are pushed with
// SuprSend's own CLI — `npm run push:assets`. There is no demo data: people are added
// in the SuprSend dashboard and projects are created in the app.
//
// Pass --dry-run to print what the run would do without sending anything.
// Re-run behaviour: adopts workspaces that already exist and only writes missing env
// lines — safe to re-run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

// The workspaces the README asks you to create. `prefix` names their env vars — the
// app finds a workspace by these (lib/workspaces.ts → workspaceKeysFromEnv).
const WORKSPACES = [
  { slug: "acme", name: "Acme", prefix: "SUPRSEND_ACME" },
  { slug: "globex", name: "Globex", prefix: "SUPRSEND_GLOBEX" },
];

const DRY_RUN = process.argv.slice(2).includes("--dry-run");

// From an ACCOUNT service token, create each customer workspace (POST /v1/workspace/,
// ServiceToken auth) and then scaffold ALL of its credentials as labelled placeholders
// in .env.local for YOU to paste from the dashboard (Developers → API Keys). We
// intentionally do NOT auto-create the keys: the Management API's create endpoints
// return values that don't map 1:1 to what the app needs (e.g. the REST "API Key" ≠
// the SDK's Workspace Key+Secret; the signing-key `id` ≠ the editor JWT `kid`, which
// must be the UID). Copying the exact dashboard values removes every mapping pitfall.
// Idempotent: only missing vars are written.
async function createWorkspaces() {
  const token = process.env.SUPRSEND_SERVICE_TOKEN;
  if (!token) {
    console.error("✗ SUPRSEND_SERVICE_TOKEN is required to create workspaces (Account → Service Tokens).");
    process.exit(1);
  }
  const mgmt = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com").replace(/\/$/, "");
  const hdr = { Authorization: `ServiceToken ${token}`, "Content-Type": "application/json" };
  const api = async (method, path, body) => {
    if (DRY_RUN && method !== "GET") {
      console.log(`  [dry-run] ${method} ${path}${body ? ` — ${JSON.stringify(body).length} bytes` : ""}`);
      return { ok: true, status: 200, data: {} };
    }
    try {
      const res = await fetch(`${mgmt}${path}`, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
      return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, data: { detail: e?.message ?? String(e) } };
    }
  };
  // Pull the workspace we care about out of a Management API response, tolerating
  // BOTH shapes: a list ({ results: [...] }) or a single workspace object.
  const pickWs = (data, name) => {
    if (!data || typeof data !== "object") return null;
    if (Array.isArray(data.results)) {
      return data.results.find((w) => (w?.name || "").toLowerCase() === name.toLowerCase())
        || (data.results.length === 1 ? data.results[0] : null);
    }
    return data.slug || data.uid ? data : null;
  };

  // Read existing .env.local — only ADD vars that are missing (idempotent; never
  // clobber a non-empty value, and never re-create a credential we already hold).
  const envPath = new URL("../.env.local", import.meta.url);
  let existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const envValue = new Map(
    existing.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  const have = new Set(envValue.keys());
  const out = []; // lines to append to .env.local
  let filled = 0; // in-place fills of previously empty vars
  // Fill a var IN PLACE when its line exists but is empty (`KEY=`). Used for the
  // workspace key, which the API gives us — everything else stays a manual paste.
  const fillInPlace = (key, value) => {
    existing = existing.replace(new RegExp(`^(${key}=)\\s*$`, "m"), `$1${value}`);
    envValue.set(key, value);
  };

  for (const ws of WORKSPACES) {
    const name = ws.name;
    const p = ws.prefix; // e.g. SUPRSEND_ACME
    const pub = `NEXT_PUBLIC_${p}`;
    console.log(`\n=== ${name} (${ws.slug}) ===`);

    // 1) Get-or-create the workspace → its SuprSend slug (the Management API path arg).
    //    List first (reuse an existing one); create only if absent. Tolerant of both
    //    response shapes, and logs the raw response if it still can't resolve.
    const listed = await api("GET", "/v1/workspace/");
    let record = pickWs(listed.data, name);
    let how = `existing (GET ${listed.status})`;
    if (!record) {
      const created = await api("POST", "/v1/workspace/", { name, description: `Keystone reference app — ${ws.slug} workspace` });
      record = pickWs(created.data, name);
      how = `created (POST ${created.status})`;
      if (!record) {
        // May have been created but returned in a shape we didn't match — re-list.
        const relisted = await api("GET", "/v1/workspace/");
        record = pickWs(relisted.data, name);
        how = `re-listed (GET ${relisted.status})`;
        if (!record) {
          console.log(`  ✗ couldn't resolve workspace (GET ${listed.status}, POST ${created.status}, re-GET ${relisted.status}).`);
          console.log(`    GET  response: ${JSON.stringify(listed.data).slice(0, 300)}`);
          console.log(`    POST response: ${JSON.stringify(created.data).slice(0, 300)}`);
          continue;
        }
      }
    }
    if (!record.slug) { console.log(`  ✗ workspace resolved but has no slug: ${JSON.stringify(record).slice(0, 300)}`); continue; }
    const slug = record.slug;
    console.log(`  ✓ workspace ${how} — uid=${record.uid} slug=${slug} mode=${record.mode}`);

    // Scaffold every credential this workspace needs, for YOU to paste from the
    // dashboard (Developers → API Keys). No API auto-creation — you copy the exact
    // values, so nothing can be mis-mapped. Only missing vars are written (never
    // clobbered). NOTE on the signing key: SIGNING_KEY_UID must be the "Signing Key UID"
    // (signing_key_…), NOT the "Signing Key ID" (ws_signk_…) — that's the value the
    // embedded editor's JWT `kid` requires (verified: uid → 200, id → 401).
    // The Workspace Key is the workspace UID the API just returned (the dashboard's
    // "Workspace Key" field shows the same value), so it's auto-filled. The other
    // four can't be: the secret and the signing-key Base64 are shown ONCE in the
    // dashboard and never returned by any API, and the public key / signing-key UID
    // live only in the dashboard's key sections.
    const keyVar = `${p}_WORKSPACE_KEY`;
    if (envValue.get(keyVar) === "") {
      if (DRY_RUN) console.log(`  [dry-run] would fill ${keyVar}=${record.uid}`);
      else {
        fillInPlace(keyVar, record.uid);
        filled += 1;
        console.log(`  ✓ filled ${keyVar} (= workspace UID)`);
      }
    }
    const creds = [
      [keyVar, `# Workspace Key      — auto-filled (= the workspace UID)`, record.uid],
      [`${p}_WORKSPACE_SECRET`, `# Workspace Secret   — "Workspace Key and Secret" section (shown once)`, ""],
      [`${pub}_PUBLIC_KEY`, `# Public Key         — "Public Keys" section (the SS.PUBK… value)`, ""],
      [`${p}_SIGNING_KEY_UID`, `# Signing Key UID    — "Signing Keys" → the "signing_key_…" UID (NOT ws_signk_…)`, ""],
      [`${p}_SIGNING_KEY_B64`, `# Signing Key Base64 — "Signing Keys" → Generate → copy the Base64 (shown once)`, ""],
    ];
    const missing = creds.filter(([k]) => !have.has(k));
    if (missing.length === 0) {
      console.log(`  • all credential lines already present — nothing appended`);
    } else {
      out.push(`\n# ── ${name} — uid=${record.uid} slug=${slug} mode=${record.mode} ──`);
      out.push(`# Paste these from SuprSend → "${name}" → Developers → API Keys:`);
      for (const [k, note, value] of missing) out.push(note, `${k}=${value}`);
      const toPaste = missing.filter(([, , v]) => v === "").length;
      console.log(`  → wrote ${missing.length} credential line(s) — ${toPaste} left to paste from the dashboard`);
    }
  }

  // Ensure the service token itself is persisted for later runs.
  if (!have.has("SUPRSEND_SERVICE_TOKEN")) out.unshift("", "# Account-level service token (management API):", `SUPRSEND_SERVICE_TOKEN=${token}`);

  if (out.length && DRY_RUN) {
    console.log(`\n  [dry-run] would append ${out.length} line(s) to .env.local`);
  } else if (out.length || filled > 0) {
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    writeFileSync(envPath, existing + (out.length ? sep + out.join("\n") + "\n" : ""));
    console.log(`\n✓ Updated .env.local (non-empty values untouched).`);
  } else {
    console.log(`\n✓ .env.local already has every credential — nothing to do.`);
  }

  console.log(
    "\nNext steps:\n" +
    "  1. Open .env.local and paste each workspace's 4 remaining credentials from the\n" +
    "     dashboard (SuprSend → the workspace → Developers → API Keys). Each blank line\n" +
    "     has a comment above it saying exactly which value to copy. (The Workspace Key\n" +
    "     is already filled in — it's the workspace UID.)\n" +
    "  2. Push the notification assets:  npm run push:assets\n" +
    "  3. Run the app:                   npm run dev\n" +
    "  4. Add users in the SuprSend dashboard, then create a project with + Project.",
  );
}

await createWorkspaces();
