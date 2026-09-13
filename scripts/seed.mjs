// Keystone seeding — creates the DEMO DATA in each customer workspace: tenants
// (projects), users (the roster), project objects and their role subscriptions.
// Run: node --env-file=.env.local scripts/seed.mjs [stage]
// Stages: tenants | users | objects | all (default: all)
//
// This script is DATA-plane only. The design-time ASSETS (templates, workflows,
// preference categories) live as plain files in suprsend/ and are pushed with
// SuprSend's own CLI — `npm run push:assets` (see scripts/push-assets.mjs). They
// are split because SuprSend's CLI manages assets but has no commands for
// tenants/users/objects/subscriptions — those need the SDK, hence this script.
//
// Bootstrap: `workspaces` (standalone) creates the workspaces from an account service
// token and appends a labelled placeholder to .env.local for each credential you then
// paste from the dashboard (Developers → API Keys). It does NOT create the keys — see
// createWorkspaces() for why. Run it FIRST, then paste the credentials, then run `all`,
// which needs the per-workspace key/secret those placeholders hold.
//
// Pass --dry-run to print what the run would do without sending anything.
//
// Re-run behaviour: every stage is an idempotent upsert — safe to re-run.

import pkg from "@suprsend/node-sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
// Sample seed data — a real deployment reads people from its own DB and syncs them
// to SuprSend via this script. The demo roster (ids/names/roles per project) is the
// single source of truth in lib/roster-seed.json, shared with the app (lib/people.ts)
// so seeding and the running app never diverge.
import rosterSeed from "../lib/roster-seed.json" with { type: "json" };
const Suprsend = pkg.Suprsend ?? pkg.default?.Suprsend ?? pkg.default ?? pkg;

// EMAIL SAFETY: every address routes to the ONE safe inbox via plus-addressing —
// never a real company domain, never a bare name@domain. Configurable per deployment
// (defaults to demo+<x>@example.com — a reserved domain that never delivers; set
// SAFE_TEST_EMAIL_USER/_DOMAIN to your own tester to actually receive test sends).
const SAFE_EMAIL_USER = process.env.SAFE_TEST_EMAIL_USER || "demo";
const SAFE_EMAIL_DOMAIN = process.env.SAFE_TEST_EMAIL_DOMAIN || "example.com";
const safeMail = (local) => `${SAFE_EMAIL_USER}+${local}@${SAFE_EMAIL_DOMAIN}`;
const ROSTER = rosterSeed.roster;

// Object type for projects (project = object, for recipient fan-out + roles).
const OBJECT_TYPE = "project";

// A project's team, built from the shared seed (lib/roster-seed.json) by tenant id.
// Email ALWAYS plus-addresses to the safe inbox so test sends reach only us (see
// safeMail above); it's derived from the name to match lib/people.ts exactly.
function team(tenantId) {
  return (ROSTER[tenantId] ?? []).map(({ id, name, role }) => ({
    id, name, email: safeMail(name.toLowerCase().replace(/\s+/g, ".")), role,
  }));
}

// One block per customer workspace. envPrefix mirrors lib/server/workspace.ts.
// Each tenant (= project) carries its team (from the seed); users are the union of
// all teams. Tenant name/brand colours are seeding-only config and live here.
const WORKSPACES = [
  {
    slug: "acme",
    prefix: "SUPRSEND_ACME",
    // Workspace default brand (SuprSend `default` tenant) — the account-wide
    // {{$brand.*}} fallback shown in Admin → Branding. The customer's own brand.
    defaultBrand: { name: "Acme", primary: "#2563EB", secondary: "#1D1D1D", tertiary: "#6B7280" },
    tenants: [
      { id: "acme-aero", name: "Aerospace — Turbine Sensors Generation 2", primary: "#0F4C81", members: team("acme-aero") },
      { id: "acme-bms", name: "Building Technologies — Smart Controls v4", primary: "#00857A", members: team("acme-bms") },
    ],
  },
  {
    slug: "globex",
    prefix: "SUPRSEND_GLOBEX",
    defaultBrand: { name: "Globex", primary: "#0F766E", secondary: "#1D1D1D", tertiary: "#6B7280" },
    tenants: [
      { id: "globex-bar", name: "Zero-Sugar Bar — Line Extension", primary: "#ED7902", members: team("globex-bar") },
      { id: "globex-minis", name: "Foil-Wrapped Minis", primary: "#7C3AED", members: team("globex-minis") },
    ],
  },
];

const args = process.argv.slice(2);
// --dry-run prints what each stage would upsert and sends nothing.
const DRY_RUN = args.includes("--dry-run");
const stage = args.find((a) => !a.startsWith("--")) ?? "all";
// `workspaces` is a standalone stage (create the workspaces from an account token) —
// NOT part of `all`, because the seeding stages below need each workspace's
// key/secret, which only exist AFTER the dashboard key-gen + env paste.
const doWorkspaces = stage === "workspaces";
const doTenants = stage === "all" || stage === "tenants";
const doUsers = stage === "all" || stage === "users";
const doObjects = stage === "all" || stage === "objects";

// Flatten each workspace's teams into a unique user list.
for (const ws of WORKSPACES) {
  const seen = new Map();
  for (const t of ws.tenants) for (const m of t.members) if (!seen.has(m.id)) seen.set(m.id, m);
  ws.users = [...seen.values()];
}

function clientFor(prefix) {
  const key = process.env[`${prefix}_WORKSPACE_KEY`];
  const secret = process.env[`${prefix}_WORKSPACE_SECRET`];
  if (!key || !secret) throw new Error(`Missing key/secret for ${prefix}`);
  // Point the Node SDK at a non-default deployment (e.g. the STAGING SuprSend)
  // when SUPRSEND_HOST is set; otherwise the SDK uses its hub.suprsend.com
  // default — so prod runs are unchanged.
  const base_url = process.env.SUPRSEND_HOST;
  return base_url ? new Suprsend(key, secret, { base_url }) : new Suprsend(key, secret);
}

// ── Workspace bootstrap (DevEx) ───────────────────────────────────────────────
// `node scripts/seed.mjs workspaces` — from an ACCOUNT service token, create each
// customer workspace (POST /v1/workspace/, ServiceToken auth) and then scaffold ALL of
// its credentials as labelled placeholders in .env.local for YOU to paste from the
// dashboard (Developers → API Keys). We intentionally do NOT auto-create the keys: the
// Management API's create endpoints return values that don't map 1:1 to what the app
// needs (e.g. the REST "API Key" ≠ the SDK's Workspace Key+Secret; the signing-key
// `id` ≠ the editor JWT `kid`, which must be the UID). Copying the exact dashboard
// values removes every mapping pitfall. Idempotent: only missing vars are written.
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
    const name = ws.defaultBrand?.name || ws.slug;
    const p = ws.prefix; // e.g. SUPRSEND_ACME
    const pub = `NEXT_PUBLIC_SUPRSEND_${ws.slug.replace(/-/g, "_").toUpperCase()}`;
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

  // Ensure the service token itself is persisted for the later seeding run.
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
    "  3. Seed the demo data:            node --env-file=.env.local scripts/seed.mjs\n" +
    "  4. Run the app:                   npm run dev",
  );
}

if (doWorkspaces) {
  await createWorkspaces();
} else {
  for (const ws of WORKSPACES) {
    console.log(`\n=== ${ws.slug} ===`);
    const c = clientFor(ws.prefix);
    const slackUrl = process.env[`${ws.prefix}_SLACK_WEBHOOK`];

  if (doTenants && DRY_RUN) console.log(`  [dry-run] would upsert ${ws.tenants.length + (ws.defaultBrand ? 1 : 0)} tenants`);
  if (doTenants && !DRY_RUN) {
    for (const t of ws.tenants) {
      try {
        await c.tenants.upsert(t.id, {
          tenant_name: t.name,
          primary_color: t.primary,
          secondary_color: "#0f172a",
          tertiary_color: "#64748b",
        });
        console.log(`  tenant ✓ ${t.id}`);
      } catch (e) {
        console.log(`  tenant ✗ ${t.id}: ${e?.message ?? e}`);
      }
    }
    // Workspace default brand → SuprSend `default` tenant (Admin → Branding).
    if (ws.defaultBrand) {
      try {
        await c.tenants.upsert("default", {
          tenant_name: ws.defaultBrand.name,
          primary_color: ws.defaultBrand.primary,
          secondary_color: ws.defaultBrand.secondary,
          tertiary_color: ws.defaultBrand.tertiary,
        });
        console.log(`  tenant ✓ default (${ws.defaultBrand.name})`);
      } catch (e) {
        console.log(`  tenant ✗ default: ${e?.message ?? e}`);
      }
    }
  }

  if (doUsers && DRY_RUN) console.log(`  [dry-run] would upsert ${ws.users.length} users`);
  if (doUsers && !DRY_RUN) {
    for (const u of ws.users) {
      try {
        const edit = c.users.get_edit_instance(u.id);
        edit.add_email(u.email);
        if (slackUrl) edit.add_slack({ incoming_webhook: { url: slackUrl } });
        // name is the greeting token templates read ({{$recipient.name}}) — a reserved
        // profile field every user-creation path sets, so object fan-out renders per
        // recipient WITHOUT a first_name custom prop (which dashboard-created users lack).
        edit.set({ name: u.name });
        // NO global `role` on the user — a person's role is PER PROJECT, stored on
        // the object subscription (recipient.subscription.role). Unset any legacy
        // global role left from earlier seeding.
        edit.unset(["role"]);
        await c.users.edit(edit);
        console.log(`  user ✓ ${u.id}`);
      } catch (e) {
        console.log(`  user ✗ ${u.id}: ${e?.message ?? e}`);
      }
    }
  }

  if (doObjects && DRY_RUN) console.log(`  [dry-run] would upsert ${ws.tenants.length} project objects + their subscriptions`);
  if (doObjects && !DRY_RUN) {
    for (const t of ws.tenants) {
      try {
        await c.objects.upsert(OBJECT_TYPE, t.id, { name: t.name });
        // Subscribe members, grouped by role (subscription property = role).
        const byRole = {};
        for (const m of t.members) (byRole[m.role] ??= []).push(m.id);
        for (const [role, ids] of Object.entries(byRole)) {
          await c.objects.create_subscriptions(OBJECT_TYPE, t.id, {
            recipients: ids,
            properties: { role },
          });
        }
        console.log(`  object ✓ ${OBJECT_TYPE}:${t.id} (${t.members.length} subscribers)`);
      } catch (e) {
        console.log(`  object ✗ ${t.id}: ${e?.message ?? e}`);
      }
    }
  }
  }
}

console.log("\nDone.");
