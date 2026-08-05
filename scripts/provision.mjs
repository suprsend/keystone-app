// Keystone provisioning — creates SuprSend resources in each customer workspace.
// Run: node --env-file=.env.local scripts/provision.mjs [stage]
// Stages: tenants | users | objects | categories | templates | workflows | all (default: all)
//
// Bootstrap: `workspaces` (standalone) creates the workspaces from an account service
// token and appends a labelled placeholder to .env.local for each credential you then
// paste from the dashboard (Developers → API Keys). It does NOT create the keys — see
// createWorkspaces() for why. Run it FIRST, then paste the credentials, then run `all`,
// which needs the per-workspace key/secret those placeholders hold.
//
// Pass --dry-run to print every API call the run would make without sending any.
//
// Re-run behaviour:
//   • templates: re-pushes the templates in suprsend/templates/ → OVERWRITES any
//     edits made by hand in the SuprSend editor. Only re-run when you intend to
//     reset the live templates to what this repo holds.
//   • workflows: re-applies the baseline conditions from conditionsFor(). Those are
//     static structure — every value a human tunes (role, except, include, the cost
//     threshold) lives on the preference CATEGORY and its tenant/user overrides,
//     which the expressions only read. A re-run restores the gating without touching
//     anyone's preferences.
//   • tenants/users/objects/categories: idempotent upserts, safe to re-run.

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
// (defaults to demo+<x>@example.com — a reserved domain that never delivers; set
// SAFE_TEST_EMAIL_USER/_DOMAIN to your own tester to actually receive test sends).
const SAFE_EMAIL_USER = process.env.SAFE_TEST_EMAIL_USER || "demo";
const SAFE_EMAIL_DOMAIN = process.env.SAFE_TEST_EMAIL_DOMAIN || "example.com";
const safeMail = (local) => `${SAFE_EMAIL_USER}+${local}@${SAFE_EMAIL_DOMAIN}`;
const ROSTER = rosterSeed.roster;

// Object type for projects (project = object, for recipient fan-out + roles).
const OBJECT_TYPE = "project";

// Workflow-node timing.
const REMINDER_LEAD = "3d"; // Tasks Coming Up — reminder this far BEFORE due_date.

// Recipient roles per notification. Also written to each workflow as
// `recip:<role-slug>` tags so the app can read/edit recipient roles live.
// Mirrors lib/notifications.ts (keys = provision/workflow slugs).
const RECIPIENTS = {
  "project-assigned": ["Project Manager", "Process Owner"],
  "project-started": ["Project Manager", "Team Member", "Project Sponsor"],
  "project-paused": ["Team Member", "Project Sponsor"],
  "task-completed": ["Project Manager"],
  "tasks-upcoming": ["Team Member", "Project Manager"],
  "comment-added": ["Project Manager", "Team Member"],
  "tagged-on-project": ["Project Manager", "Team Member", "Project Sponsor", "Process Owner"],
  "budget-alert": ["Project Manager", "Project Sponsor", "Process Owner"],
};

// ── Category condition attributes ("properties") ──────────────────────────────
// These are the workspace DEFAULTS that the workflow conditions read
// ($category.properties.*) and that the app's Preferences screen edits:
//   role    → the Recipients column (which roles a notification targets)
//   except  → the Except column (people always skipped)
//   include → "Always notify" (people notified regardless of role)
//   cost    → the Conditions column (an integer gate; only Budget Alert uses it)
// A tenant (project) or user can override each — that IS the preference model this
// app demonstrates, so provisioning them is what makes the demo work.
const ROLE_CHOICES = ["Project Manager", "Project Sponsor", "Process Owner", "Team Member"];
const dynamicUsers = (key, label, optional) => ({
  key, label, value_type: "list_dynamic", is_optional: optional,
  edit_policy: "editable", dynamic_choices_key: "workspace_users", default_value: null,
});
// `extra` carries the cost attribute for the notifications that gate on a threshold.
function categoryProps(slug, extra = []) {
  return [
    {
      key: "role", label: "Role", value_type: "list_choice", is_optional: false, edit_policy: "editable",
      choices: ROLE_CHOICES.map((r) => ({ label: r, value: r })),
      // SuprSend rejects [] — an empty role list is expressed as null.
      default_value: RECIPIENTS[slug]?.length ? RECIPIENTS[slug] : null,
    },
    dynamicUsers("except", "Except", false),
    dynamicUsers("include", "Always notify", true),
    ...extra,
  ];
}
const costProp = (label, value) => ({
  key: "cost", label, value_type: "integer", is_optional: false, edit_policy: "editable", default_value: value,
});

// Comment Added is the digest showcase: the account default is a daily digest, and a
// project (tenant) or a person can override the frequency/time from the app.
const COMMENT_DIGEST = {
  enabled: true,
  options: [
    { id: "instant", label: "Instant", frequency: "instantly", is_default: false },
    { id: "hourly", label: "Hourly", frequency: "hourly", interval: 2, is_default: false,
      time: { edit_policy: "editable", default_value: "18:00" } },
    { id: "daily_6pm", label: "Daily", frequency: "daily", interval: 1, is_default: true,
      time: { edit_policy: "locked", default_value: "00:00" } },
  ],
};
const roleSlug = (r) => r.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const recipientTags = (slug) => (RECIPIENTS[slug] ?? []).map((r) => `recip:${roleSlug(r)}`);

// ── Workflow conditions ───────────────────────────────────────────────────────
// These are what turn the category properties above into actual gating, and they are
// what makes the preference model demonstrable. Each block is OR'd; args within a
// block are AND'd. Shapes verified against a live reference workspace:
//   role    — the subscriber's per-project role is in the category's role list
//   cost    — the trigger's `cost` exceeds the category's threshold (Budget Alert)
//   except  — the subscriber isn't on the Except list …
//   EMPTY   — …plus a twin block for when Except is empty (NOT_CONTAINS does not
//             match against an empty list, so the empty case needs its own branch)
//   include — "Always notify" wins regardless of role
//   object  — lets the project OBJECT through so SuprSend can expand it into subscribers
const A_ROLE = { op: "CONTAINS", value: "$recipient.subscription.role", variable: "properties.role", variable_ns: "$category" };
const A_COST = { op: ">", value: "$category.properties.cost", variable: "cost", variable_ns: "" };
const A_EXCEPT_NOT = { op: "NOT_CONTAINS", value: "$recipient.distinct_id", variable: "properties.except", variable_ns: "$category" };
const A_EXCEPT_EMPTY = { op: "EMPTY", value: "", variable: "properties.except", variable_ns: "$category" };
const A_INCLUDE = { op: "CONTAINS", value: "$recipient.distinct_id", variable: "properties.include", variable_ns: "$category" };
const A_IS_OBJECT = { op: "==", value: '"object"', variable: "$type", variable_ns: "$recipient" };
const block = (args) => ({ type: "expression_v1", expression_v1: { op: "AND", args } });

function conditionsFor(slug) {
  // Budget Alert additionally gates on the cost threshold.
  const gate = slug === "budget-alert" ? [A_ROLE, A_COST] : [A_ROLE];
  return [
    block([...gate, A_EXCEPT_NOT]),
    block([A_INCLUDE]),
    block([A_IS_OBJECT]),
    block([...gate, A_EXCEPT_EMPTY]),
  ];
}

// OBJECT-fan-out notifications: triggered with the project OBJECT as recipient,
// SuprSend fans out to ALL of its subscribers. These are the notifications whose
// audience is "people on the project" (vs. an action-specific individual). Who
// actually receives one is narrowed by the workflow's role/except conditions, which
// read the preference category — see conditionsFor().
//
// The rest target a person determined by the ACTION (the assignee, the @mentioned
// person, the new PM) — SuprSend can't infer that from the object, so the app
// triggers those to the specific recipient.
const OBJECT_NOTIFS = new Set(["project-started", "project-paused", "comment-added", "task-completed", "budget-alert"]);

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

// Every workspace gets the same 8 categories (the user-facing preference toggles).
// Grouped into sections under the `transactional` root. opt_in = on by default.
const CATEGORY_SECTIONS = [
  { name: "Assignments", categories: [
    { category: "project-assigned", name: "Project Assigned", description: "When a project manager is assigned or changed.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"], properties: categoryProps("project-assigned") },
  ] },
  { name: "Project status", categories: [
    { category: "project-started", name: "Project Started", description: "When a project's status is set to in-flight.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"], properties: categoryProps("project-started") },
    { category: "project-paused", name: "Project Paused", description: "When a project is paused.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"], properties: categoryProps("project-paused") },
  ] },
  { name: "Tasks", categories: [
    { category: "task-completed", name: "Task Completed", description: "When a task on a project is marked complete.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"], properties: categoryProps("task-completed") },
    { category: "tasks-upcoming", name: "Tasks Coming Up", description: "When a task assigned to you is approaching its due date.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"], properties: categoryProps("tasks-upcoming") },
  ] },
  { name: "Collaboration", categories: [
    { category: "comment-added", name: "Comment Added", description: "When a comment is added to a project you're on.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox", "slack"], properties: categoryProps("comment-added"), digest_schedule: COMMENT_DIGEST },
    { category: "tagged-on-project", name: "Tagged on a Project", description: "When someone @mentions you on a project.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox", "slack"], properties: categoryProps("tagged-on-project") },
  ] },
  // Budget Alert is the CONDITIONS showcase: it only sends when the project's cost
  // exceeds this threshold (`cost > $category.properties.cost`), and an Admin/PM can
  // change the threshold per project from the app.
  { name: "Budget", categories: [
    { category: "budget-alert", name: "Budget Alert", description: "When a project's cost exceeds its budget ceiling.", default_preference: "opt_in", default_opt_in_channels: ["email", "inbox"], properties: categoryProps("budget-alert", [costProp("Cost Exceeded", 30000)]) },
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
  // PER-RECIPIENT COPY: one template, different words per recipient, keyed on the
  // reader's per-project role ($recipient.subscription.role) — which SuprSend
  // resolves during object fan-out. The new PM reads "you are now the PM"; everyone
  // else reads who the new PM is. The email says this with display conditions on the
  // design blocks; inbox uses {{#compare}} below.
  { slug: "project-assigned", name: "Project Assigned",
    subject: "Project manager changed for {{$brand.brand_name}}",
    line: "{{#compare $recipient.subscription.role '==' \"Project Manager\"}}You are now the project manager for {{$brand.brand_name}}.{{else}}The new project manager for {{$brand.brand_name}} is {{new_pm_name}}.{{/compare}}",
    inboxHeader: "{{#compare $recipient.subscription.role '==' \"Project Manager\"}}You're now PM of {{$brand.brand_name}}{{else}}Project manager changed for {{$brand.brand_name}}{{/compare}}",
    sample: { new_pm_name: "Dana Carter", project_link: LINK } },
  { slug: "project-started", name: "Project Started", subject: "{{$brand.brand_name}} has started", line: "Project {{$brand.brand_name}} is now in-flight. Open the project to see your tasks and the current stage gate.", inboxHeader: "{{$brand.brand_name}} started",
    sample: { project_link: LINK } },
  { slug: "project-paused", name: "Project Paused", subject: "{{$brand.brand_name}} has been paused", line: "The project {{$brand.brand_name}} has been paused. You'll be notified when work restarts.", inboxHeader: "{{$brand.brand_name}} paused",
    sample: { project_link: LINK } },
  { slug: "task-completed", name: "Task Completed", subject: "Task completed: {{task_name}}", line: "{{task_assignee}} has completed the task \"{{task_name}}\" for the project {{$brand.brand_name}}.", inboxHeader: "Task completed: {{task_name}}",
    sample: { task_name: "Design FMEA review", task_assignee: "Karen Brooks", project_link: LINK } },
  // Tasks Coming Up — reminder fires a fixed window BEFORE the due date (Wait-Until
  // node). `due_date` is the machine ISO timestamp the delay pivots on; the template
  // shows the human `due_date_display`. Both are trigger fields (known at trigger).
  { slug: "tasks-upcoming", name: "Tasks Coming Up", subject: "Due soon: {{task_name}}", line: "\"{{task_name}}\" for the project {{$brand.brand_name}} is due {{due_date_display}}.", inboxHeader: "Due soon: {{task_name}}",
    sample: { task_name: "Submit gate deliverables", task_id: "TASK-501", due_date: "2026-07-15T17:00:00Z", due_date_display: "Jul 15, 2026", project_link: LINK } },
  // Comment Added — BATCHED per project (batch_key=.project_id). The workflow sends
  // the `comment-added-batched` template, which renders the $batched_events list.
  { slug: "comment-added", name: "Comment Added", template: "comment-added-batched", channels: ["email", "inbox", "slack"], batched: true,
    sample: { is_batch: true, batch_count: 3, payload: { project_id: "acme-aero", comment_author: "Karen Brooks", comment_body: "Pushed the latest FMEA — can you review section 3?", project_link: LINK } } },
  { slug: "tagged-on-project", name: "Tagged on a Project", subject: "{{actor_name}} tagged you on {{$brand.brand_name}}", line: "{{actor_name}} tagged you in a comment on {{$brand.brand_name}}:<br/><br/>&ldquo;{{comment_body}}&rdquo;", inboxHeader: "{{actor_name}} tagged you", channels: ["email", "inbox", "slack"],
    sample: { actor_name: "Marcus Hale", comment_body: "Sarah, can you confirm the FMEA scope before Friday?", project_link: LINK } },
  // Budget Alert — the CONDITIONS showcase. Its workflow only sends when the trigger's
  // `cost` exceeds the category's threshold (`cost > $category.properties.cost`), which
  // an Admin/PM can change per project. Object fan-out, so the role condition picks who.
  { slug: "budget-alert", name: "Budget Alert", subject: "Budget exceeded on {{$brand.brand_name}}", line: "{{$brand.brand_name}} has gone over its budget ceiling. Current cost is ${{cost}}. Please review the project budget.", inboxHeader: "Budget exceeded: {{$brand.brand_name}}",
    sample: { cost: 45000, project_link: LINK } },
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

// The email designs live in suprsend/templates/<slug>/email/default/ as a pair:
// body.designer.json is the visual-designer block tree the editor canvas loads, and
// body.designer.html is what SuprSend renders and sends. Both are pushed together —
// design_json alone leaves the canvas blank, html alone leaves it uneditable.
function emailDesigner(slug) {
  const dir = new URL(`../suprsend/templates/${slug}/email/default/`, import.meta.url);
  return {
    html: readFileSync(new URL("body.designer.html", dir), "utf8"),
    design_json: JSON.parse(readFileSync(new URL("body.designer.json", dir), "utf8")),
  };
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

const args = process.argv.slice(2);
// --dry-run prints every Management API call the run would make and sends none, so a
// stage can be reviewed before it touches a workspace. It does NOT cover the Node SDK
// stages (tenants/users/objects) — those are guarded separately, see DRY_RUN below.
const DRY_RUN = args.includes("--dry-run");
// Stand-in for a write that --dry-run suppressed. Reads (GET) still go through, so
// stages that look something up before deciding what to write behave normally.
const dryRunSkip = (method, path, body) => {
  console.log(`  [dry-run] ${method} ${path}${body ? ` — ${JSON.stringify(body).length} bytes` : ""}`);
  return { ok: true, status: 200, data: {} };
};
const stage = args.find((a) => !a.startsWith("--")) ?? "all";
// `workspaces` is a standalone stage (create the workspaces from an account token) —
// NOT part of `all`, because the provisioning stages below need each workspace's
// key/secret, which only exist AFTER the dashboard key-gen + env paste.
// A 409 "no_changes_to_commit" means the template/workflow is already committed with
// identical content (common on a re-run) — that's success, not a failure.
const isNoChanges = (r) => r?.status === 409 && r?.data?.error_code === "no_changes_to_commit";
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
// `node scripts/provision.mjs workspaces` — from an ACCOUNT service token, create each
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
    if (DRY_RUN && method !== "GET") return dryRunSkip(method, path, body);
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

    // Scaffold every credential this workspace needs, for YOU to paste from the
    // dashboard (Developers → API Keys). No API auto-creation — you copy the exact
    // values, so nothing can be mis-mapped. Only missing vars are written (never
    // clobbered). NOTE on the signing key: SIGNING_KEY_UID must be the "Signing Key UID"
    // (signing_key_…), NOT the "Signing Key ID" (ws_signk_…) — that's the value the
    // embedded editor's JWT `kid` requires (verified: uid → 200, id → 401).
    const creds = [
      [`${p}_WORKSPACE_KEY`, `# Workspace Key      — "Workspace Key and Secret" section`],
      [`${p}_WORKSPACE_SECRET`, `# Workspace Secret   — same section (shown once)`],
      [`${pub}_PUBLIC_KEY`, `# Public Key         — "Public Keys" section (the SS.PUBK… value)`],
      [`${p}_SIGNING_KEY_UID`, `# Signing Key UID    — "Signing Keys" → the "signing_key_…" UID (NOT ws_signk_…)`],
      [`${p}_SIGNING_KEY_B64`, `# Signing Key Base64 — "Signing Keys" → Generate → copy the Base64 (shown once)`],
    ];
    const missing = creds.filter(([k]) => !have.has(k));
    if (missing.length === 0) {
      console.log(`  • all credentials already set — skipped`);
    } else {
      out.push(`# Paste these from SuprSend → "${name}" → Developers → API Keys:`);
      for (const [k, note] of missing) out.push(note, `${k}=`);
      console.log(`  → wrote ${missing.length} credential placeholder(s) — paste them from the dashboard`);
    }
  }

  // Ensure the service token itself is persisted for the later provisioning run.
  if (!have.has("SUPRSEND_SERVICE_TOKEN")) out.unshift("", "# Account-level service token (management API):", `SUPRSEND_SERVICE_TOKEN=${token}`);

  if (out.length && DRY_RUN) {
    console.log(`\n  [dry-run] would append ${out.length} line(s) to .env.local`);
  } else if (out.length) {
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    writeFileSync(envPath, existing + sep + out.join("\n") + "\n");
    console.log(`\n✓ Updated .env.local (existing values untouched).`);
  } else {
    console.log(`\n✓ .env.local already has every credential — nothing to do.`);
  }

  console.log(
    "\nNext steps:\n" +
    "  1. Open .env.local and paste each workspace's 5 credentials from the dashboard\n" +
    "     (SuprSend → the workspace → Developers → API Keys). Each blank line has a\n" +
    "     comment above it saying exactly which value to copy.\n" +
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
        // global role left from earlier provisioning.
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
      if (DRY_RUN && method !== "GET") return dryRunSkip(method, path, body);
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
      const inboxBody = n.batched
        ? `You have ${COMMENT_COUNT} on {{$brand.brand_name}}. Open the project to catch up.`
        : n.line;
      const slack = channels.includes("slack") ? slackBlocks(n) : null;
      try {
        const base = `/v2/${wsKey}/template/${slug}`;
        await send("POST", `${base}/`, {
          name, description: subject, tags: ["keystone"], enabled_channels: channels,
        });
        // Build each channel's content ONCE and publish it as the MASTER variant
        // (tenant_id null). There are no per-tenant variants: a project's branding
        // comes from its tenant brand at render time via {{$brand.*}}, which the
        // designs already read, so one variant serves every project.
        const contentByChannel = {};
        if (channels.includes("email")) contentByChannel.email = {
          templating_language: "handlebars", subject,
          body: { type: "designer", designer: { ...emailDesigner(slug), text: "", merge_tags: [], display_conditions: [] } },
        };
        if (channels.includes("inbox")) contentByChannel.inbox = {
          templating_language: "handlebars", schema_version: "1.0", header: inboxHeader, body: inboxBody,
          action_url: "", open_in_new_tab: false, image_url: "", subtext: null, importance: "default",
          avatar: null, tags: [], is_expiry_enabled: false, expiry: null, is_pinned: false, buttons: [], extra_data: "",
        };
        if (channels.includes("slack") && slack) contentByChannel.slack = {
          templating_language: "handlebars", body_type: "block", body_text: "", body_block: toJsonnet({ blocks: slack }),
        };
        // Master variant only. The app's resolveTenantVariantId falls back to
        // "default" when a tenant has no variant of its own.
        const variantTargets = [{ id: "default", tenant_id: null }];
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
        const ok = commit.ok || isNoChanges(commit);
        console.log(`  template ${ok ? "✓" : "✗"} ${slug} [${channels.join("+")}] (commit HTTP ${commit.status}${isNoChanges(commit) ? " — already up to date" : ""})`);
        if (!ok) console.log(`    ${JSON.stringify(commit.data).slice(0, 250)}`);
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
      if (DRY_RUN && method !== "GET") return dryRunSkip(method, path, body);
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
          // Digest comments. schedule_type "category_digest_schedule" makes the node
          // read the Comment Added category's digest schedule — so the frequency a
          // person or a project picks in Preferences (instant / hourly / daily) is what
          // actually governs delivery. Comments accumulate into $batched_events and go
          // out as one message per digest close. (Mentions are urgent and handled
          // separately by the immediate Tagged-on-a-Project workflow.)
          nodes = [
            { ref: "digest_1", name: "Digest", node_type: "digest", schema_version: "1", description: null, properties: {
              schedule_type: "category_digest_schedule", trigger_min_count: 1,
              retain_count: 10, retain_order: "first",
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
          // Conditions ARE provisioned (see conditionsFor): without them a fresh
          // workspace has no role/except/cost gating at all, so there is nothing to
          // demonstrate. They are safe to re-apply because they are static STRUCTURE —
          // every value a human tunes (role, except, include, the cost threshold) lives
          // on the preference CATEGORY (and its tenant/user overrides), which these
          // expressions only read via $category.properties.*. Re-running restores the
          // baseline gating without touching anyone's preferences.
          conditions: conditionsFor(n.slug),
          tree: { nodes },
        };
        const commit = await send("POST", `${base}/?commit=true&commit_message=${encodeURIComponent("Object/API rework")}`, body);
        const ok = commit.ok || isNoChanges(commit);
        console.log(`  workflow ${ok ? "✓" : "✗"} ${n.slug} [${isEvent ? "event:TASKS_UPCOMING" : isObject ? "api,object→all subscribers" : "api,individual"}] (HTTP ${commit.status}${isNoChanges(commit) ? " — already up to date" : `, status=${commit.data?.status}`})`);
        if (!ok) console.log(`    ${JSON.stringify(commit.data).slice(0, 400)}`);
      } catch (e) {
        console.log(`  workflow ✗ ${n.slug}: ${e?.message ?? e}`);
      }
    }
  }
  }
}

console.log("\nDone.");
