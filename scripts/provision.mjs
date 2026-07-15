// Keystone provisioning — creates SuprSend resources in each customer workspace.
// Run: node --env-file=.env.local scripts/provision.mjs [stage]
// Stages: tenants | users | objects | categories | templates | workflows | all (default: all)
//
// DevEx bootstrap: `workspaces` (standalone) creates the workspaces AND their auth
// keys (public/signing/api) from an account service token and writes them into
// .env.local — run it FIRST, then run `all`. It is NOT part of `all` (the stages
// below read the per-workspace key/secret it writes). One key→env mapping is still
// unconfirmed with SuprSend; see createWorkspaces() below.
//
// ⚠️ NOT a safe blind re-run for the `templates`/`workflows` stages:
//   • templates: re-pushes the raw-HTML templates here → OVERWRITES any Visual
//     Designer templates edited by hand in the dashboard. Don't re-run `templates`
//     unless you intend to reset the VD work.
//   • workflows: this script does NOT manage conditions (it omits them, so a re-run
//     PRESERVES live conditions). The live role/except/self-action/cost/object-block
//     /budget conditions are managed separately (and edited from the app's preference
//     UI) — they are NOT re-applied here. NEVER reintroduce `conditions: []` here
//     (that would wipe them).
// The tenants/users stages are idempotent upserts and safe to re-run.

import pkg from "@suprsend/node-sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
// Sample seed data — a real deployment reads people from its own DB and syncs them
// to SuprSend via this script. The demo roster (ids/names/roles per project) is the
// single source of truth in lib/roster-seed.json, shared with the app (lib/people.ts)
// so provisioning and the running app never diverge.
import rosterSeed from "../lib/roster-seed.json" with { type: "json" };
const Suprsend = pkg.Suprsend ?? pkg.default?.Suprsend ?? pkg.default ?? pkg;

// EMAIL SAFETY: every address routes to the ONE safe inbox via plus-addressing —
// never a real company domain, never a bare name@domain. Configurable per deployment
// (defaults to nikita+<x>@suprsend.com).
const SAFE_EMAIL_USER = process.env.SAFE_TEST_EMAIL_USER || "nikita";
const SAFE_EMAIL_DOMAIN = process.env.SAFE_TEST_EMAIL_DOMAIN || "suprsend.com";
const safeMail = (local) => `${SAFE_EMAIL_USER}+${local}@${SAFE_EMAIL_DOMAIN}`;
const ROSTER = rosterSeed.roster;

// Object type for projects (project = object, for recipient fan-out + roles).
const OBJECT_TYPE = "project";

// Workflow-node timing. Demo-friendly so a batch closes / a reminder fires within
// a test session (a real deployment would use ~30m batch, 3d reminder lead).
const BATCH_WINDOW = "5m"; // Comment Added — batch window per project.
const REMINDER_LEAD = "3d"; // Tasks Coming Up — reminder this far BEFORE due_date.

// PRD recipient roles per notification. Also written to each workflow as
// `recip:<role-slug>` tags so the app can read/edit recipient types LIVE (Task 6).
// Mirrors lib/notifications.ts (keys = provision/workflow slugs).
const RECIPIENTS = {
  "project-assigned": ["Project Manager", "Process Owner"],
  "project-started": ["Project Manager", "Team Member", "Project Sponsor"],
  "project-paused": ["Team Member", "Project Sponsor"],
  "task-completed": ["Project Manager"],
  "tasks-upcoming": ["Team Member", "Project Manager"],
  "comment-added": ["Project Manager", "Team Member"],
  "tagged-on-project": ["Project Manager", "Team Member", "Project Sponsor", "Process Owner"],
};
const roleSlug = (r) => r.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const recipientTags = (slug) => (RECIPIENTS[slug] ?? []).map((r) => `recip:${roleSlug(r)}`);

// OBJECT-fan-out notifications: triggered with the project OBJECT as recipient,
// SuprSend fans out to ALL of its subscribers. These are the notifications whose
// audience is "people on the project" (vs. an action-specific individual).
//
// ROLE FILTERING IS DEFERRED (founder, Jun 24): for now every subscriber on the
// project receives these — we do NOT filter by role yet. When we add it, the
// filter goes in a BRANCH step on `recipient.subscription.role` (the per-project
// role on the object subscription) — proven to be the only placement that filters
// per subscriber; the same condition at the trigger level matches no one because
// the trigger gate runs before the object expands into individual subscribers.
//
// The other four notifications target a person determined by the ACTION (the
// assignee, the @mentioned person, the new/previous PM) — SuprSend can't infer
// that from the object, so the app triggers those to the specific recipient(s).
const OBJECT_NOTIFS = new Set(["project-started", "project-paused", "comment-added", "task-completed"]);

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
// all teams. Tenant name/brand colours are provisioning-only config and live here.
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

// Every workspace gets the same 7 categories (the user-facing preference toggles).
// Grouped into sections under the `transactional` root. opt_in = on by default.
const CATEGORY_SECTIONS = [
  { name: "Assignments", categories: [
    { category: "project-assigned", name: "Project Assigned", description: "When a project manager is assigned or changed.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"] },
  ] },
  { name: "Project status", categories: [
    { category: "project-started", name: "Project Started", description: "When a project's status is set to in-flight.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"] },
    { category: "project-paused", name: "Project Paused", description: "When a project is paused.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"] },
  ] },
  { name: "Tasks", categories: [
    { category: "task-completed", name: "Task Completed", description: "When a task on a project is marked complete.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"] },
    { category: "tasks-upcoming", name: "Tasks Coming Up", description: "When a task assigned to you is approaching its due date.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"] },
  ] },
  { name: "Collaboration", categories: [
    { category: "comment-added", name: "Comment Added", description: "When a comment is added to a project you're on.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox", "slack"] },
    { category: "tagged-on-project", name: "Tagged on a Project", description: "When someone @mentions you on a project.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox", "slack"] },
  ] },
];

// A plausible Keystone project link for previews/tests.
const LINK = "https://app.keystone.example/projects/demo";

// One template per notification (email + inbox content). Slug = category slug, so
// the workflow→template→category triple lines up.
//
// `channels` is the template's enabled channel set (drives both the template
// variants and which send_* nodes the workflow gets). `sample` is the preview /
// test payload — every {{variable}} a template references must have a value here
// (so the SuprSend preview resolves and the app's "Send test" prefills). For
// batched templates, `sample` is ONE flat event + is_batch/batch_count (the
// dashboard replicates payload × batch_count to build $batched_events).
const NOTIFICATIONS = [
  // PER-RECIPIENT COPY: one template, three messages keyed on `recipient_type`
  // (fired per recipient by the Workspace Data action / fan-out). The new PM, the
  // previous PM, and the process owner each get the right words — instead of one
  // shared "you are now PM" going to everyone (the PRD defect this fixes).
  { slug: "project-assigned", name: "Project Assigned",
    subject: "{{#compare recipient_type '==' \"new_pm\"}}You're now managing {{$brand.brand_name}}{{else}}{{#compare recipient_type '==' \"previous_pm\"}}You've been removed from {{$brand.brand_name}}{{else}}New project manager for {{$brand.brand_name}}{{/compare}}{{/compare}}",
    line: "{{#compare recipient_type '==' \"new_pm\"}}You are now the project manager for {{$brand.brand_name}}. The previous manager has been notified of the change.{{else}}{{#compare recipient_type '==' \"previous_pm\"}}You've been removed as the project manager for {{$brand.brand_name}}. {{new_pm_name}} is now managing it.{{else}}A new project manager, {{new_pm_name}}, was assigned to {{$brand.brand_name}}.{{/compare}}{{/compare}}",
    inboxHeader: "{{#compare recipient_type '==' \"new_pm\"}}You're now PM of {{$brand.brand_name}}{{else}}{{#compare recipient_type '==' \"previous_pm\"}}Removed from {{$brand.brand_name}}{{else}}New PM for {{$brand.brand_name}}{{/compare}}{{/compare}}",
    sample: { recipient_type: "new_pm", new_pm_name: "Dana Carter", previous_pm_name: "Evan Cole", project_link: LINK } },
  { slug: "project-started", name: "Project Started", subject: "{{$brand.brand_name}} has started", line: "{{$brand.brand_name}} is now in-flight. Open the project to see your tasks and the current stage gate.", inboxHeader: "{{$brand.brand_name}} started",
    sample: { project_link: LINK } },
  { slug: "project-paused", name: "Project Paused", subject: "{{$brand.brand_name}} has been paused", line: "{{$brand.brand_name}} has been paused. You'll be notified when work restarts.", inboxHeader: "{{$brand.brand_name}} paused",
    sample: { project_link: LINK } },
  { slug: "task-completed", name: "Task Completed", subject: "Task completed: {{task_name}}", line: "{{task_assignee}} marked \"{{task_name}}\" complete on {{$brand.brand_name}}.", inboxHeader: "Task completed: {{task_name}}",
    sample: { task_name: "Design FMEA review", task_assignee: "Karen Brooks", project_link: LINK } },
  // Tasks Coming Up — reminder fires a fixed window BEFORE the due date (Wait-Until
  // node). `due_date` is the machine ISO timestamp the delay pivots on; the template
  // shows the human `due_date_display`. Both are trigger fields (known at trigger).
  { slug: "tasks-upcoming", name: "Tasks Coming Up", subject: "Due soon: {{task_name}}", line: "\"{{task_name}}\" on {{$brand.brand_name}} is due {{due_date_display}}.", inboxHeader: "Due soon: {{task_name}}",
    sample: { task_name: "Submit gate deliverables", task_id: "TASK-501", due_date: "2026-07-15T17:00:00Z", due_date_display: "Jul 15, 2026", project_link: LINK } },
  // Comment Added — BATCHED per project (batch_key=.project_id). The workflow sends
  // the `comment-added-batched` template, which renders the $batched_events list.
  { slug: "comment-added", name: "Comment Added", template: "comment-added-batched", channels: ["email", "inbox", "slack"], batched: true,
    sample: { is_batch: true, batch_count: 3, payload: { project_id: "acme-aero", comment_author: "Karen Brooks", comment_body: "Pushed the latest FMEA — can you review section 3?", project_link: LINK } } },
  { slug: "tagged-on-project", name: "Tagged on a Project", subject: "{{actor_name}} tagged you on {{$brand.brand_name}}", line: "{{actor_name}} tagged you in a comment on {{$brand.brand_name}}:<br/><br/>&ldquo;{{comment_body}}&rdquo;", inboxHeader: "{{actor_name}} tagged you", channels: ["email", "inbox", "slack"],
    sample: { actor_name: "Marcus Hale", comment_body: "Sarah, can you confirm the FMEA scope before Friday?", project_link: LINK } },
];

// The batched Comment Added template — its own definition because it renders a
// LIST of events. Slug differs from the category (comment-added); the workflow
// points its send nodes here.
// Count phrase reused in subject/header/body. NO {{#compare}} helper — it failed to
// resolve in the SuprSend template PREVIEW (left the whole batched template raw,
// subject included). Plural-always, matching the known-good batched reference.
const COMMENT_COUNT = `{{$batched_events_count}} new comments`;
const BATCHED_COMMENT = {
  slug: "comment-added-batched",
  name: "Comment Added (batched)",
  subject: `${COMMENT_COUNT} on {{$brand.brand_name}}`,
  inboxHeader: `${COMMENT_COUNT} on {{$brand.brand_name}}`,
};

function emailHtml(n) {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <p style="font-size:14px;color:#475569">Hi {{$recipient.name}},</p>
  <p style="font-size:15px;line-height:1.5">${n.line}</p>
  <p style="margin-top:24px"><a href="{{project_link}}" style="background:#5350F0;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">Open in Keystone</a></p>
  <p style="font-size:12px;color:#94a3b8;margin-top:28px">Sent by your innovation team via Keystone.</p>
</div>`;
}

// Batched email: each item is a <tr> of the OUTER container table, with its own
// nested layout table inside — the only structure that renders in the SuprSend
// dashboard preview (inner-table {{#if}} between data rows shows raw handlebars).
// Mirrors the known-good batched reference: a FULL HTML document with role=
// "presentation" tables and each {{#if $batched_events.[n]}} wrapping a complete
// <tr>. (The previous <div>-fragment + {{#compare}} version rendered raw in the
// SuprSend preview.) Renders + sends both verified.
function batchedCommentHtml() {
  const item = (i) => `  {{#if $batched_events.[${i}]}}
  <tr>
    <td style="padding:16px 40px 0 40px;">
      <p style="margin:0 0 6px 0;font-size:14px;font-weight:600;color:#1a1a2e;">{{$batched_events.[${i}].comment_author}}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="border-left:3px solid #e5e7eb;padding:6px 0 6px 12px;font-size:13px;color:#51545e;line-height:1.5;">&ldquo;{{$batched_events.[${i}].comment_body}}&rdquo;</td></tr>
      </table>
    </td>
  </tr>
  {{/if}}`;
  const items = Array.from({ length: 10 }, (_, i) => item(i)).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>New comments</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
  <tr>
    <td style="padding:32px 40px 0 40px;">
      <p style="margin:0;font-size:14px;color:#475569;">Hi {{$recipient.name}},</p>
      <h1 style="margin:12px 0 0 0;font-size:18px;font-weight:700;color:#1a1a2e;line-height:1.4;">You have ${COMMENT_COUNT} on {{$brand.brand_name}}.</h1>
    </td>
  </tr>
  <tr><td style="padding:20px 40px 0 40px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
${items}
  <tr>
    <td style="padding:24px 40px 32px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td style="background-color:#5350F0;border-radius:6px;"><a href="{{{$batched_events.[0].project_link}}}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Open in Keystone</a></td></tr>
      </table>
      <p style="margin:20px 0 0 0;font-size:12px;color:#9a9ea6;">Sent by your innovation team via Keystone.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Slack block content per notification (handlebars form; converted to JSONNET on
// push). Only the channels list decides whether a slack variant is created.
function slackBlocks(n) {
  if (n.slug === "tagged-on-project") {
    return [
      { type: "section", text: { type: "mrkdwn", text: "*{{actor_name}}* tagged you on *{{$brand.brand_name}}*" } },
      { type: "section", text: { type: "mrkdwn", text: "“{{comment_body}}”" } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in Keystone" }, url: "{{project_link}}" }] },
    ];
  }
  if (n.slug === "comment-added") {
    // Slack jsonnet can't do {{#each}}/conditionals, so show the latest comment's
    // author + text (named + interpretable) instead of a bare count.
    return [
      { type: "section", text: { type: "mrkdwn", text: "*{{$batched_events.[0].comment_author}}* commented on *{{$brand.brand_name}}*" } },
      { type: "section", text: { type: "mrkdwn", text: "“{{$batched_events.[0].comment_body}}”" } },
      // batched context → no top-level project_link; use the first event's link.
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in Keystone" }, url: "{{$batched_events.[0].project_link}}" }] },
    ];
  }
  return null;
}

// ── Slack handlebars → JSONNET (ported from lib/suprsend-mgmt.ts) ──
// SuprSend Slack body_block is JSONNET where vars are data.key, not {{key}}.
// Namespaced ($-prefixed) refs use bracket access; plain/dotted use dot access.
function refToJsonnet(ref) {
  // Tokenize into object keys and [index] parts so array access (e.g.
  // $batched_events.[0].comment_author) converts to data["$batched_events"][0]["comment_author"].
  const re = /\[(\d+)\]|([\w$]+)/g;
  let out = "data", m;
  while ((m = re.exec(ref.trim()))) {
    out += m[1] !== undefined ? `[${m[1]}]` : `[${JSON.stringify(m[2])}]`;
  }
  return out;
}
function strToJsonnet(s) {
  if (!/\{\{/.test(s)) return JSON.stringify(s);
  // Allow [n] array indices in the variable path (not just \w/$/.).
  const re = /\{\{\{?\s*([\w$][\w$.\[\]]*)\s*\}?\}\}/g;
  const parts = [];
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(JSON.stringify(s.slice(last, m.index)));
    parts.push(refToJsonnet(m[1]));
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(JSON.stringify(s.slice(last)));
  return parts.length ? parts.join(" + ") : '""';
}
function toJsonnet(v) {
  if (typeof v === "string") return strToJsonnet(v);
  if (Array.isArray(v)) return `[${v.map(toJsonnet).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).map(([k, val]) => `${JSON.stringify(k)}:${toJsonnet(val)}`).join(",")}}`;
  return JSON.stringify(v);
}

const stage = process.argv[2] ?? "all";
// `workspaces` is a standalone DevEx stage (create the workspaces from an account
// token) — NOT part of `all`, because the provisioning stages below need each
// workspace's key/secret, which only exist AFTER the dashboard key-gen + env paste.
const doWorkspaces = stage === "workspaces";
const doTenants = stage === "all" || stage === "tenants";
const doUsers = stage === "all" || stage === "users";
const doObjects = stage === "all" || stage === "objects";
const doCategories = stage === "all" || stage === "categories";
const doTemplates = stage === "all" || stage === "templates";
const doWorkflows = stage === "all" || stage === "workflows";

// SuprSend derives category slugs from the NAME — match that so the workflow's
// category = its preference sub-category (enables per-category preference gating).
const catSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

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
// `node scripts/provision.mjs workspaces` — from an ACCOUNT service token alone,
// create each customer workspace AND its auth keys via the Management API, writing
// them straight into .env.local (idempotent: only fills vars that are missing, never
// clobbers, and skips creating a credential you already have — key material is shown
// only once). All calls are ServiceToken-authed and use the workspace SLUG (returned
// by Create Workspace) as the path param.
//
// Endpoints (all under https://management-api.suprsend.com):
//   POST /v1/workspace/                → { uid, slug, mode }            (metadata only)
//   POST /v1/{slug}/ws_public_key/     → { api_key }                    → NEXT_PUBLIC_*_PUBLIC_KEY
//   POST /v1/{slug}/ws_signing_key/    → { id, private_key_base64 }     → *_SIGNING_KEY_ID / _B64
//
// The backend Node SDK (latest, v1.15.x) authenticates with the WORKSPACE KEY +
// WORKSPACE SECRET — a pair DISTINCT from the REST "API Key" the ws_api_key endpoint
// returns (feeding that key to the SDK is rejected with 401). No Management API returns
// this pair; it lives in the dashboard (Developers → API Keys). So those two vars are
// left as labelled placeholders to paste once — the only hand-copied step. The public
// key and signing key are created and filled automatically.
async function createWorkspaces() {
  const token = process.env.SUPRSEND_SERVICE_TOKEN;
  if (!token) {
    console.error("✗ SUPRSEND_SERVICE_TOKEN is required to create workspaces (Account → Service Tokens).");
    process.exit(1);
  }
  const mgmt = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com").replace(/\/$/, "");
  const hdr = { Authorization: `ServiceToken ${token}`, "Content-Type": "application/json" };
  const api = async (method, path, body) => {
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
  // clobber, and never re-create a credential we already hold).
  const envPath = new URL("../.env.local", import.meta.url);
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const have = new Set(
    existing.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => l.slice(0, l.indexOf("=")).trim()).filter(Boolean),
  );
  const out = []; // lines to append to .env.local

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
    out.push(`\n# ── ${name} — uid=${record.uid} slug=${slug} mode=${record.mode} ──`);

    // 2) Public key (browser inbox) → NEXT_PUBLIC_*_PUBLIC_KEY. Confirmed mapping.
    if (have.has(`${pub}_PUBLIC_KEY`)) {
      console.log(`  • public key already set — skipped`);
    } else {
      const r = await api("POST", `/v1/${slug}/ws_public_key/`, { name: "keystone-web", description: "Keystone browser inbox" });
      if (r.ok && r.data?.api_key) { out.push(`${pub}_PUBLIC_KEY=${r.data.api_key}`); console.log(`  ✓ public key created`); }
      else console.log(`  ✗ public key (HTTP ${r.status}) ${JSON.stringify(r.data).slice(0, 160)}`);
    }

    // 3) Signing key (in-app template editor JWT) → *_SIGNING_KEY_ID / _B64. Confirmed.
    if (have.has(`${p}_SIGNING_KEY_ID`) && have.has(`${p}_SIGNING_KEY_B64`)) {
      console.log(`  • signing key already set — skipped`);
    } else {
      const r = await api("POST", `/v1/${slug}/ws_signing_key/`, {});
      if (r.ok && r.data?.id && r.data?.private_key_base64) {
        out.push(`${p}_SIGNING_KEY_ID=${r.data.id}`, `${p}_SIGNING_KEY_B64=${r.data.private_key_base64}`);
        console.log(`  ✓ signing key created`);
      } else console.log(`  ✗ signing key (HTTP ${r.status}) ${JSON.stringify(r.data).slice(0, 160)}`);
    }

    // 4) Backend Node SDK auth (*_WORKSPACE_KEY / _SECRET). CONFIRMED against the
    //    latest SDK (v1.15.x): it authenticates with new Suprsend(workspace_key,
    //    workspace_secret) — a pair DISTINCT from the REST "API Key", sourced from the
    //    dashboard (Developers → API Keys). No Management API endpoint returns this
    //    pair (ws_api_key returns the REST key, which the SDK rejects with 401), so we
    //    leave labelled placeholders for the dev to paste once. Everything above is
    //    auto-filled; this is the only hand-copied step.
    if (have.has(`${p}_WORKSPACE_KEY`) && have.has(`${p}_WORKSPACE_SECRET`)) {
      console.log(`  • workspace key/secret already set — skipped`);
    } else {
      out.push(
        `# Paste ${name}'s Workspace Key + Secret from the dashboard (the backend Node SDK`,
        `# uses this pair; it is NOT returned by any create API). In SuprSend: switch to`,
        `# "${name}" → Developers → API Keys — both are shown at the top of the page.`,
        `${p}_WORKSPACE_KEY=`,
        `${p}_WORKSPACE_SECRET=`,
      );
      console.log(`  → workspace key/secret: paste from dashboard (placeholder written to .env.local)`);
    }
  }

  // Ensure the service token itself is persisted for the later provisioning run.
  if (!have.has("SUPRSEND_SERVICE_TOKEN")) out.unshift("", "# Account-level service token (management API):", `SUPRSEND_SERVICE_TOKEN=${token}`);

  if (out.length) {
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    writeFileSync(envPath, existing + sep + out.join("\n") + "\n");
    console.log(`\n✓ Updated .env.local (existing values untouched).`);
  } else {
    console.log(`\n✓ .env.local already has every credential — nothing to do.`);
  }

  console.log(
    "\nNext steps:\n" +
    "  1. Confirm the WORKSPACE_KEY/SECRET mapping note in .env.local with the SuprSend team.\n" +
    "  2. Provision resources:  node --env-file=.env.local scripts/provision.mjs\n" +
    "  3. Run the app:          npm run dev",
  );
}

if (doWorkspaces) {
  await createWorkspaces();
} else {
  for (const ws of WORKSPACES) {
    console.log(`\n=== ${ws.slug} ===`);
    const c = clientFor(ws.prefix);
    const slackUrl = process.env[`${ws.prefix}_SLACK_WEBHOOK`];

  if (doTenants) {
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

  if (doUsers) {
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
        // global role left from earlier provisioning.
        edit.unset(["role"]);
        await c.users.edit(edit);
        console.log(`  user ✓ ${u.id}`);
      } catch (e) {
        console.log(`  user ✗ ${u.id}: ${e?.message ?? e}`);
      }
    }
  }

  if (doObjects) {
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

  if (doCategories) {
    const wsKey = process.env[`${ws.prefix}_WORKSPACE_KEY`];
    const token = process.env.SUPRSEND_SERVICE_TOKEN;
    const mgmt = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com").replace(/\/$/, "");
    const body = {
      root_categories: [
        { root_category: "system" },
        { root_category: "transactional", sections: CATEGORY_SECTIONS },
        { root_category: "promotional" },
      ],
    };
    try {
      // commit=true publishes the categories (draft → live) so they surface to the
      // subscriber preference API.
      const res = await fetch(`${mgmt}/v1/${wsKey}/preference_category/?commit=true&commit_message=${encodeURIComponent("Initial categories")}`, {
        method: "POST",
        headers: { Authorization: `ServiceToken ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      const valid = data?.validation_result?.is_valid;
      console.log(`  categories ${res.ok && valid !== false ? "✓" : "✗"} (HTTP ${res.status}, valid=${valid})`);
      if (!res.ok || valid === false) console.log(`    ${JSON.stringify(data).slice(0, 300)}`);
    } catch (e) {
      console.log(`  categories ✗ ${e?.message ?? e}`);
    }
  }

  if (doTemplates) {
    const wsKey = process.env[`${ws.prefix}_WORKSPACE_KEY`];
    const token = process.env.SUPRSEND_SERVICE_TOKEN;
    const mgmt = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com").replace(/\/$/, "");
    const hdr = { Authorization: `ServiceToken ${token}`, "Content-Type": "application/json" };
    const send = async (method, path, body) => {
      const res = await fetch(`${mgmt}${path}`, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
      return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
    };
    for (const n of NOTIFICATIONS) {
      // Resolve the template to push (a batched notification points at its own
      // list-rendering template, e.g. comment-added → comment-added-batched).
      const slug = n.template ?? n.slug;
      const channels = n.channels ?? ["email", "inbox"];
      const subject = n.batched ? BATCHED_COMMENT.subject : n.subject;
      const inboxHeader = n.batched ? BATCHED_COMMENT.inboxHeader : n.inboxHeader;
      const name = n.batched ? BATCHED_COMMENT.name : n.name;
      const html = n.batched ? batchedCommentHtml() : emailHtml(n);
      const inboxBody = n.batched
        ? `You have ${COMMENT_COUNT} on {{$brand.brand_name}}. Open the project to catch up.`
        : n.line;
      const slack = channels.includes("slack") ? slackBlocks(n) : null;
      try {
        const base = `/v2/${wsKey}/template/${slug}`;
        await send("POST", `${base}/`, {
          name, description: subject, tags: ["keystone"], enabled_channels: channels,
        });
        // Build each channel's content ONCE, then publish it as the MASTER variant
        // (tenant_id null) PLUS one variant per PROJECT tenant — so every project
        // gets its own editable, brandable variant (visible in SuprSend → Variants),
        // mirroring the multi-tenant template setup in fiix/BTS. Per-tenant {{$brand.*}}
        // auto-injects, and admins can diverge any project's variant in the editor.
        const contentByChannel = {};
        if (channels.includes("email")) contentByChannel.email = {
          templating_language: "handlebars", subject,
          // type:"raw" so the SuprSend HTML editor (dashboard + the app's embedded
          // editor) opens WITH this content and the preview renders. "designer" with
          // only designer.html leaves both editors blank (matches the working app
          // path — see emailVariantContent in lib/suprsend-mgmt.ts).
          body: { type: "raw", raw: { html, text: "" } },
        };
        if (channels.includes("inbox")) contentByChannel.inbox = {
          templating_language: "handlebars", schema_version: "1.0", header: inboxHeader, body: inboxBody,
          action_url: "", open_in_new_tab: false, image_url: "", subtext: null, importance: "default",
          avatar: null, tags: [], is_expiry_enabled: false, expiry: null, is_pinned: false, buttons: [], extra_data: "",
        };
        if (channels.includes("slack") && slack) contentByChannel.slack = {
          templating_language: "handlebars", body_type: "block", body_text: "", body_block: toJsonnet({ blocks: slack }),
        };
        // variant id = tenant id (matches resolveTenantVariantId in the app); master = "default".
        const variantTargets = [{ id: "default", tenant_id: null }, ...ws.tenants.map((t) => ({ id: t.id, tenant_id: t.id }))];
        for (const [channel, content] of Object.entries(contentByChannel)) {
          for (const v of variantTargets) {
            const r = await send("POST", `${base}/channel/${channel}/variant/${v.id}/`, {
              channel, id: v.id, tenant_id: v.tenant_id, locale: "en", conditions: [], content,
            });
            if (!r.ok) console.log(`    variant ✗ ${slug}/${channel}/${v.id} (HTTP ${r.status}) ${JSON.stringify(r.data).slice(0, 160)}`);
          }
        }
        // Preview/test payload. Point the preview at a REAL recipient + tenant so
        // {{$recipient.name}} and {{$brand.brand_name}} resolve in the editor
        // preview (without these the preview has no recipient → "name not
        // defined"). Batched samples carry is_batch+batch_count so the dashboard
        // replicates payload × batch_count into $batched_events.
        const previewTenant = ws.tenants[0];
        const previewRecipient = previewTenant.members[0].id;
        const mockData = {
          ...(n.batched ? n.sample : { payload: n.sample }),
          recipient_distinct_id: previewRecipient,
          recipient_sub_type: "user",
          tenant_id: previewTenant.id,
        };
        await send("PATCH", `${base}/mock_data/`, { data: mockData });
        const commit = await send("PATCH", `${base}/commit/?commit_message=${encodeURIComponent("Initial version")}`);
        console.log(`  template ${commit.ok ? "✓" : "✗"} ${slug} [${channels.join("+")}] (commit HTTP ${commit.status})`);
        if (!commit.ok) console.log(`    ${JSON.stringify(commit.data).slice(0, 250)}`);
      } catch (e) {
        console.log(`  template ✗ ${slug}: ${e?.message ?? e}`);
      }
    }
  }

  if (doWorkflows) {
    const wsKey = process.env[`${ws.prefix}_WORKSPACE_KEY`];
    const token = process.env.SUPRSEND_SERVICE_TOKEN;
    const mgmt = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com").replace(/\/$/, "");
    const hdr = { Authorization: `ServiceToken ${token}`, "Content-Type": "application/json" };
    const send = async (method, path, body) => {
      const res = await fetch(`${mgmt}${path}`, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
      return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
    };
    for (const n of NOTIFICATIONS) {
      try {
        const base = `/v1/${wsKey}/workflow/${n.slug}`;
        const tmpl = n.template ?? n.slug;
        // ONE multi-channel send per send point. With `channels` unset, it delivers
        // on ALL of the template's active channels (the same `chans` set), and
        // per-user/per-category preferences then filter each channel. Kept as a
        // 1-element array so the `...sendNodes` / `nodes = sendNodes` uses below
        // (wait-until + batch branches) stay unchanged.
        const sendNodes = [{
          ref: "send", name: "Send", node_type: "send_multi_channel", properties: { template: tmpl },
        }];

        let nodes;
        if (n.slug === "tasks-upcoming") {
          // Wait-Until: send the reminder a fixed window BEFORE due_date (timeout
          // branch, which keeps the original trigger payload — so due_date_display
          // renders). If the task is completed first (TASK_COMPLETED matching the
          // same task_id), take the condition branch and stop — no reminder.
          nodes = [{
            ref: "wait_due", name: "Remind before due date", node_type: "branch_waituntil", properties: {},
            branches: [
              {
                // Cancel on TASK_CLOSED (a per-recipient signal fired to BOTH the
                // assignee and PM when the task is completed) so each person's
                // reminder cancels on their OWN timeline. (TASK_COMPLETED is the
                // PM-only EMAIL event and only lands on the PM's timeline — using it
                // here would leave the assignee's reminder firing after completion.)
                name: "Task closed first", ref: "wu_done", is_default: false, is_terminal: true,
                conditions: [{
                  type: "future_event", event_name: "TASK_CLOSED",
                  event_conditions: [{ type: "expression_v1", expression_v1: { op: "AND", args: [
                    { variable_ns: "$future_event", variable: "task_id", op: "==", value: "task_id" },
                  ] } }],
                }],
                nodes: [],
              },
              {
                name: "Due date approaching", ref: "wu_due", is_default: true,
                conditions: [{ type: "delay", delay_properties: {
                  delay_type: "relative_to",
                  relative_to: { pivot_expr: ".due_date", offset_type: "before", offset_value_type: "fixed", offset_value: REMINDER_LEAD },
                } }],
                nodes: sendNodes,
              },
            ],
          }];
        } else if (n.slug === "comment-added") {
          // Batch comments per project. flush_leading_item → the FIRST comment in a
          // window is sent IMMEDIATELY (count=1), the rest accumulate and go out as one
          // digest at window close ($batched_events). So you're alerted to the first
          // comment right away but not spammed for a burst. (Mentions are urgent and
          // handled separately by the immediate Tagged-on-a-Project workflow.)
          nodes = [
            { ref: "batch_1", name: "Batch comments per project", node_type: "batch", properties: {
              mode: "flush_leading_item", window_type: "fixed", fixed_window: BATCH_WINDOW,
              batch_key: ".project_id", retain_count: 10, retain_order: "first",
            } },
            ...sendNodes,
          ];
        } else {
          nodes = sendNodes;
        }

        // Most workflows are API-triggered (the app calls workflows.trigger). Object
        // notifications fan out to ALL the project object's subscribers (role filtering
        // deferred — see OBJECT_NOTIFS note above). category = the preference
        // sub-category slug so opting out still suppresses.
        //
        // EXCEPTION — `tasks-upcoming` is EVENT-triggered: adding a task with a due
        // date emits the TASKS_UPCOMING event (track_event) for the assignee; the
        // wait-until then schedules the reminder relative to due_date. No cron. The
        // reminder cancels if a TASK_CLOSED event arrives first (task completed).
        const isObject = OBJECT_NOTIFS.has(n.slug);
        const isEvent = n.slug === "tasks-upcoming";
        const body = {
          name: n.name,
          description: n.subject ?? n.name,
          trigger_type: isEvent ? "event" : "api",
          ...(isEvent ? { trigger_events: ["TASKS_UPCOMING"] } : {}),
          category: catSlug(n.name),
          tags: ["workspace-activity", ...recipientTags(n.slug)],
          // Conditions are OMITTED on purpose: a re-run then PRESERVES whatever
          // conditions are live (managed separately / from the app's preference UI).
          // Do NOT add `conditions: []` here — that would wipe the live role/except/
          // self-action/cost/object-block conditions.
          tree: { nodes },
        };
        const commit = await send("POST", `${base}/?commit=true&commit_message=${encodeURIComponent("Object/API rework")}`, body);
        console.log(`  workflow ${commit.ok ? "✓" : "✗"} ${n.slug} [${isEvent ? "event:TASKS_UPCOMING" : isObject ? "api,object→all subscribers" : "api,individual"}] (HTTP ${commit.status}, status=${commit.data?.status})`);
        if (!commit.ok) console.log(`    ${JSON.stringify(commit.data).slice(0, 400)}`);
      } catch (e) {
        console.log(`  workflow ✗ ${n.slug}: ${e?.message ?? e}`);
      }
    }
  }
  }
}

console.log("\nDone.");
