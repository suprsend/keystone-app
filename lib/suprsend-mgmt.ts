// SuprSend Management API client.
// One account-level Service Token (account-scoped); the workspace is the URL path
// segment. Workflows live under v1, templates under v2.
import "server-only";
import type { WorkspaceSlug } from "@/lib/workspaces";
import { getWorkspace } from "@/lib/workspaces";
import { hasWorkspaceKeys, envPrefix } from "@/lib/server/workspace";

const MGMNT = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com/").replace(/\/$/, "");

/** True when this workspace has no SuprSend keys → return empty list data (no fake fallback). */
function isMock(ws: WorkspaceSlug): boolean {
  return !hasWorkspaceKeys(getWorkspace(ws));
}

function authHeaders(): Record<string, string> {
  const token = process.env.SUPRSEND_SERVICE_TOKEN;
  if (!token) throw new Error("SUPRSEND_SERVICE_TOKEN is not set");
  return { Authorization: `ServiceToken ${token}`, "Content-Type": "application/json" };
}

export interface MgmtResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T;
}

// The Management API path segment is the SuprSend WORKSPACE KEY (not our app
// slug). Resolve it from env; fall back to the slug for mock/dev.
function wsPathSegment(ws: WorkspaceSlug): string {
  const key = process.env[`${envPrefix(getWorkspace(ws))}_WORKSPACE_KEY`];
  return key || ws;
}

async function call<T = unknown>(
  ws: WorkspaceSlug,
  version: "v1" | "v2",
  path: string,
  init?: RequestInit,
): Promise<MgmtResult<T>> {
  const url = `${MGMNT}/${version}/${wsPathSegment(ws)}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

// ───────────────────────── Templates (v2) ─────────────────────────

export type TemplateChannel = "email" | "inbox" | "sms" | "whatsapp" | "slack" | "androidpush" | "iospush" | "webpush";
export const TEMPLATE_CHANNELS: TemplateChannel[] = ["email", "inbox", "sms", "whatsapp", "slack", "androidpush", "iospush", "webpush"];

export interface TemplateSummary {
  slug: string;
  name: string;
  description?: string | null;
  enabled_channels?: string[];
  status?: string;
  version_no?: number | null;
  updated_at?: string;
  last_triggered_at?: string | null;
  channels?: { channel: string; is_active: boolean; variants_count: number }[];
}

export interface EmailContent {
  subject: string;
  html: string;
}
export interface InboxContent {
  title: string;
  body: string;
  button?: { text: string; url: string };
}
export interface TextContent {
  body: string;
}
/** Push (Android / iOS / Web) content — a title + body, the common subset. */
export interface PushContent {
  title: string;
  body: string;
  actionUrl?: string;
}
export type SlackBlock = Record<string, unknown>;
export interface SlackContent {
  blocks: SlackBlock[];
}

/** A template the AI author produces: metadata + per-channel content. */
export interface TemplateDraft {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  email?: EmailContent;
  inbox?: InboxContent;
  sms?: TextContent;
  whatsapp?: TextContent;
  slack?: SlackContent;
  androidpush?: PushContent;
  iospush?: PushContent;
  webpush?: PushContent;
  /** Example values for every merge variable — drives the SuprSend preview. */
  sampleData?: Record<string, string>;
}

// Push email as HTML/raw mode (type:"raw") so the SuprSend editor opens the HTML
// editor with our content and the preview renders — NOT "designer", which leaves
// the visual canvas empty (you can't push blocks to the drag-and-drop designer).
function emailVariantContent(c: EmailContent) {
  return {
    templating_language: "handlebars",
    subject: c.subject,
    body: {
      type: "raw",
      raw: { html: c.html, text: "" },
    },
  };
}

function inboxVariantContent(c: InboxContent) {
  return {
    templating_language: "handlebars",
    schema_version: "1.0",
    header: c.title,
    body: c.body,
    action_url: "",
    open_in_new_tab: false,
    image_url: "",
    subtext: null,
    importance: "default",
    avatar: null,
    tags: [],
    is_expiry_enabled: false,
    expiry: null,
    is_pinned: false,
    buttons: c.button ? [{ text: c.button.text, url: c.button.url, open_in_new_tab: true }] : [],
    extra_data: "",
  };
}

function smsVariantContent(c: TextContent) {
  return { templating_language: "handlebars", type: "basic", category: "", header: "", body: c.body };
}

// WhatsApp forbids a {{variable}} as the first or last token of the body. The LLM
// can't be trusted to honor this, so enforce it deterministically.
function safeWhatsappBody(body: string): string {
  let b = body.trim();
  if (/^\{\{/.test(b)) b = `Hi, ${b}`;
  if (/\}\}$/.test(b)) b = `${b}.`;
  return b;
}

function whatsappVariantContent(c: TextContent, sample?: Record<string, string>) {
  const text = safeWhatsappBody(c.body);
  // WhatsApp validates that every variable in the body has an example value.
  const vars = [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
  const parameters_dict: Record<string, string> = {};
  for (const v of vars) parameters_dict[v] = sample?.[v] ?? v;
  return {
    templating_language: "handlebars",
    category: "UTILITY",
    subcategory: "basic_interactive",
    header: null,
    body: { text, parameters_dict },
    footer: null,
    button_type: "NONE",
    buttons: [],
  };
}

// SuprSend Slack body_block is JSONNET, where variables are `data.key` — NOT
// handlebars {{key}}. We keep blocks in handlebars form internally (previewable,
// editable) and convert to JSONNET only on push. e.g.
//   "*{{company}}*"            →  "*" + data.company + "*"
//   url: "{{link}}"            →  url: data.link
//   "{{$brand.brand_name}}"    →  data["$brand"].brand_name
//   "{{$recipient.name}}"      →  data["$recipient"].name
// Namespaced refs ($brand/$recipient/$actor/…) use bracket access because `$` is
// reserved in Jsonnet; plain + dotted refs use dot access. (Per the SuprSend
// jsonnet-syntax skill: tenant = data["$brand"].key, recipient = data["$recipient"].key.)
function refToJsonnet(ref: string): string {
  const segs = ref.trim().split(".");
  const first = segs[0];
  const head = first.startsWith("$") ? `data[${JSON.stringify(first)}]` : `data.${first}`;
  return head + segs.slice(1).map((s) => `.${s}`).join("");
}
function strToJsonnet(s: string): string {
  if (!/\{\{/.test(s)) return JSON.stringify(s);
  // Match {{ var }} and {{{ var }}}, where var may be dotted and/or $-namespaced.
  const re = /\{\{\{?\s*([\w$][\w$.]*)\s*\}?\}\}/g;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(JSON.stringify(s.slice(last, m.index)));
    parts.push(refToJsonnet(m[1]));
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(JSON.stringify(s.slice(last)));
  return parts.length ? parts.join(" + ") : '""';
}
function toJsonnet(v: unknown): string {
  if (typeof v === "string") return strToJsonnet(v);
  if (Array.isArray(v)) return `[${v.map(toJsonnet).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v).map(([k, val]) => `${JSON.stringify(k)}:${toJsonnet(val)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
/** Reverse: JSONNET body_block → handlebars blocks (best-effort, for read/edit). */
function jsonnetToBlocks(src: string): SlackBlock[] {
  // data["$ns"].a.b → "{{$ns.a.b}}"  (namespaced bracket access first)
  let s = src.replace(/\bdata\[(['"])(\$[\w]+)\1\]((?:\.\w+)*)/g, (_m, _q, ns, tail) => `"{{${ns}${tail}}}"`);
  // data.a.b.c → "{{a.b.c}}"  (plain + dotted access)
  s = s.replace(/\bdata((?:\.\w+)+)\b/g, (_m, tail) => `"{{${tail.slice(1)}}}"`);
  // then collapse "a" + "b" string concatenations into "ab".
  let prev: string;
  do {
    prev = s;
    s = s.replace(/"\s*\+\s*"/g, "");
  } while (s !== prev);
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : (parsed.blocks ?? []);
  } catch {
    return [];
  }
}

function slackVariantContent(c: SlackContent) {
  return {
    templating_language: "handlebars",
    body_type: "block",
    body_text: "",
    body_block: toJsonnet({ blocks: c.blocks }),
  };
}

// Push variant content (Android/iOS/Web share this shape on SuprSend). The title
// field is `header`; `body` is the message. icon_url defaults to the brand logo.
function pushVariantContent(c: PushContent) {
  return {
    templating_language: "handlebars",
    header: c.title,
    body: c.body,
    action_url: c.actionUrl ?? "",
    icon_url: "{{$brand.logo}}",
  };
}

// One place that maps a channel → the draft field that holds it + its content builder.
const CHANNEL_CONTENT: Record<TemplateChannel, (d: TemplateDraft) => object | null> = {
  email: (d) => (d.email ? emailVariantContent(d.email) : null),
  inbox: (d) => (d.inbox ? inboxVariantContent(d.inbox) : null),
  sms: (d) => (d.sms ? smsVariantContent(d.sms) : null),
  whatsapp: (d) => (d.whatsapp ? whatsappVariantContent(d.whatsapp, d.sampleData) : null),
  slack: (d) => (d.slack && d.slack.blocks?.length ? slackVariantContent(d.slack) : null),
  androidpush: (d) => (d.androidpush ? pushVariantContent(d.androidpush) : null),
  iospush: (d) => (d.iospush ? pushVariantContent(d.iospush) : null),
  webpush: (d) => (d.webpush ? pushVariantContent(d.webpush) : null),
};

export async function listTemplates(ws: WorkspaceSlug): Promise<TemplateSummary[]> {
  if (isMock(ws)) return [];
  const r = await call<{ results?: TemplateSummary[] }>(ws, "v2", "template/?limit=100");
  return r.ok ? r.body.results ?? [] : [];
}

export function getTemplate(ws: WorkspaceSlug, slug: string): Promise<MgmtResult<TemplateSummary>> {
  if (isMock(ws)) {
    return Promise.resolve({ ok: false, status: 404, body: {} as TemplateSummary });
  }
  return call<TemplateSummary>(ws, "v2", `template/${slug}/`);
}

/**
 * Resolve the embedded-editor `variantId` for a tenant. A variant's key is
 * (variant_id, tenant_id, locale) — each tenant (including `default`) has its OWN
 * variant with its own id (e.g. "1", "2", "3"), assigned at creation — NOT the
 * tenant id, and NOT "default" (that id belongs to the master at tenant_id=null,
 * which the embedded editor can't load). So we look it up live: find the variant
 * whose tenant_id matches and return its id. Fallback (no variant yet) → the
 * tenant id itself, so the editor creates the override under a stable id.
 */
export async function resolveTenantVariantId(
  ws: WorkspaceSlug,
  slug: string,
  tenantId: string,
): Promise<string> {
  if (!tenantId) return "default";
  // The variant id is consistent across a template's channels, so probing one
  // (the first enabled) is enough. Fall back to email if meta is unavailable.
  const meta = await getTemplate(ws, slug);
  const channel = (meta.ok && meta.body.enabled_channels?.[0]) || "email";
  const r = await call<{ results?: { id?: string; tenant_id?: string | null }[] }>(
    ws,
    "v2",
    `template/${slug}/channel/${channel}/variant/`,
  );
  const match = (r.ok ? r.body.results ?? [] : []).find((v) => v.tenant_id === tenantId);
  // When the tenant has no override variant, fall back to the MASTER variant
  // ("default") rather than the tenant id — the tenant id is not a real variant id
  // and 404s as "Variant not found". The tenant scope still rides on tenantId.
  return match?.id ?? "default";
}

interface EmailVariantBody {
  content?: {
    subject?: string;
    body?: { type?: string; raw?: { html?: string }; designer?: { html?: string } };
  };
}
interface InboxVariantBody {
  content?: { header?: string; body?: string; buttons?: { text?: string; url?: string }[] };
}
interface MockDataBody {
  data?: { payload?: Record<string, string> };
}

/** Reconstruct a TemplateDraft (metadata + per-channel content) from a live template. */
export async function getTemplateDraft(ws: WorkspaceSlug, slug: string): Promise<TemplateDraft | null> {
  const meta = await getTemplate(ws, slug);
  if (!meta.ok) return null;
  const channels = meta.body.enabled_channels ?? [];
  const draft: TemplateDraft = {
    slug,
    name: meta.body.name,
    description: meta.body.description ?? undefined,
  };
  if (channels.includes("email")) {
    const v = await call<EmailVariantBody>(ws, "v2", `template/${slug}/channel/email/variant/default/`);
    const c = v.body.content;
    const b = c?.body;
    // Pick the source of truth by mode: raw HTML mode → raw.html; legacy visual
    // designer → designer.html (its raw.html is just an empty builder shell).
    const html = b?.type === "designer" ? (b?.designer?.html ?? "") : (b?.raw?.html ?? b?.designer?.html ?? "");
    draft.email = { subject: c?.subject ?? "", html };
  }
  if (channels.includes("inbox")) {
    const v = await call<InboxVariantBody>(ws, "v2", `template/${slug}/channel/inbox/variant/default/`);
    const c = v.body.content;
    const btn = c?.buttons?.[0];
    draft.inbox = {
      title: c?.header ?? "",
      body: c?.body ?? "",
      button: btn?.text && btn?.url ? { text: btn.text, url: btn.url } : undefined,
    };
  }
  if (channels.includes("sms")) {
    const v = await call<{ content?: { body?: string } }>(ws, "v2", `template/${slug}/channel/sms/variant/default/`);
    draft.sms = { body: v.body.content?.body ?? "" };
  }
  if (channels.includes("whatsapp")) {
    const v = await call<{ content?: { body?: { text?: string } } }>(ws, "v2", `template/${slug}/channel/whatsapp/variant/default/`);
    draft.whatsapp = { body: v.body.content?.body?.text ?? "" };
  }
  if (channels.includes("slack")) {
    const v = await call<{ content?: { body_block?: string; body_text?: string } }>(ws, "v2", `template/${slug}/channel/slack/variant/default/`);
    const c = v.body.content;
    let blocks: SlackBlock[] = [];
    if (c?.body_block) {
      // body_block is JSONNET (data.x refs) — convert back to handlebars blocks.
      blocks = jsonnetToBlocks(c.body_block);
      if (blocks.length === 0) {
        try {
          const parsed = JSON.parse(c.body_block); // legacy plain-JSON blocks
          blocks = Array.isArray(parsed) ? parsed : (parsed.blocks ?? []);
        } catch {
          // fall through
        }
      }
    }
    // Legacy/hybrid text-mode Slack: wrap the mrkdwn body into a section block so it
    // survives the read → edit → publish round-trip instead of vanishing.
    if (blocks.length === 0 && c?.body_text) {
      blocks = [{ type: "section", text: { type: "mrkdwn", text: c.body_text } }];
    }
    draft.slack = { blocks };
  }
  for (const ch of ["androidpush", "iospush", "webpush"] as const) {
    if (channels.includes(ch)) {
      const v = await call<{ content?: { header?: string; body?: string; action_url?: string } }>(ws, "v2", `template/${slug}/channel/${ch}/variant/default/`);
      const c = v.body.content;
      draft[ch] = { title: c?.header ?? "", body: c?.body ?? "", actionUrl: c?.action_url || undefined };
    }
  }
  const mock = await call<MockDataBody>(ws, "v2", `template/${slug}/mock_data/`);
  if (mock.ok && mock.body.data?.payload && Object.keys(mock.body.data.payload).length > 0) {
    draft.sampleData = mock.body.data.payload;
  }
  return draft;
}

export function deleteTemplate(ws: WorkspaceSlug, slug: string) {
  return call(ws, "v2", `template/${slug}/`, { method: "DELETE" });
}

/**
 * Publish a template: create metadata → set each channel's default variant → commit.
 * Returns the first failing step (so the caller can keep the workflow unpublished).
 */
export async function publishTemplate(
  ws: WorkspaceSlug,
  draft: TemplateDraft,
): Promise<MgmtResult> {
  const channels = TEMPLATE_CHANNELS.filter((ch) => CHANNEL_CONTENT[ch](draft) !== null);
  if (channels.length === 0) {
    return { ok: false, status: 400, body: { error: "template has no channels" } };
  }

  const meta = await call(ws, "v2", `template/${draft.slug}/`, {
    method: "POST",
    body: JSON.stringify({
      name: draft.name,
      description: draft.description ?? "",
      tags: ["keystone", "ai-authored"],
      enabled_channels: channels,
    }),
  });
  if (!meta.ok) return meta;

  for (const ch of channels) {
    const content = CHANNEL_CONTENT[ch](draft);
    const v = await call(ws, "v2", `template/${draft.slug}/channel/${ch}/variant/default/`, {
      method: "POST",
      body: JSON.stringify({ channel: ch, id: "default", tenant_id: null, locale: "en", conditions: [], content }),
    });
    if (!v.ok) return v;
  }

  // Push sample data so the SuprSend preview resolves merge tags (no red "not
  // defined" errors). Non-fatal: a mock-data failure shouldn't block publish.
  await setMockData(ws, draft.slug, draft.sampleData);

  const committed = await call(ws, "v2", `template/${draft.slug}/commit/?commit_message=${encodeURIComponent("Published from Keystone")}`, {
    method: "PATCH",
    body: JSON.stringify({}),
  });
  // An identical re-publish has nothing to commit — that's a success, not a failure.
  return isNoChanges(committed) ? { ok: true, status: 200, body: { status: "active" } } : committed;
}

function isNoChanges(r: MgmtResult): boolean {
  const body = r.body as { error_code?: string } | undefined;
  return r.status === 409 && body?.error_code === "no_changes_to_commit";
}

/** Set the template's preview payload (the {{variable}} sample values). */
export async function setMockData(ws: WorkspaceSlug, slug: string, sample?: Record<string, string>) {
  if (!sample || Object.keys(sample).length === 0) return;
  try {
    await call(ws, "v2", `template/${slug}/mock_data/`, {
      method: "PATCH",
      body: JSON.stringify({ data: { payload: sample } }),
    });
  } catch {
    // ignore — preview data is best-effort
  }
}

// ───────────────────────── Workflows (v1) ─────────────────────────

export interface WorkflowSummary {
  slug: string;
  name: string;
  trigger_type?: string;
  category?: string;
  description?: string;
  status?: string;
  updated_at?: string;
  last_executed_at?: string | null;
  updated_by?: { name?: string; email?: string };
  tree?: { nodes?: unknown[] };
}

// List ALL workflows (live + draft-only). `mode=draft` returns every workflow but
// stamps each with the draft status; `mode=live` returns only published ones. So
// we take the full list from draft and mark a workflow "active" (Live) when it also
// has a published (live) version — matching SuprSend's Live/Draft column exactly.
export async function listWorkflows(ws: WorkspaceSlug): Promise<WorkflowSummary[]> {
  if (isMock(ws)) return [];
  const [all, live] = await Promise.all([
    call<{ results?: WorkflowSummary[] }>(ws, "v1", "workflow/?mode=draft&limit=100"),
    call<{ results?: WorkflowSummary[] }>(ws, "v1", "workflow/?mode=live&limit=100"),
  ]);
  const liveSlugs = new Set((live.ok ? live.body.results ?? [] : []).map((w) => w.slug));
  const list = all.ok ? all.body.results ?? [] : [];
  return list.map((w) => ({ ...w, status: liveSlugs.has(w.slug) ? "active" : "draft" }));
}

// Fetch a workflow's definition. Live first; fall back to the draft for workflows
// that have never been published.
export async function getWorkflow(ws: WorkspaceSlug, slug: string): Promise<MgmtResult> {
  if (isMock(ws)) {
    return Promise.resolve({ ok: false, status: 404, body: {} });
  }
  const live = await call(ws, "v1", `workflow/${slug}/?mode=live`);
  if (live.ok) return live;
  return call(ws, "v1", `workflow/${slug}/?mode=draft`);
}

interface WorkflowTreeNode {
  node_type?: string;
  properties?: { template?: string };
  branches?: { nodes?: WorkflowTreeNode[] }[];
}

function collectTemplateSlugs(nodes: WorkflowTreeNode[] = [], acc = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.node_type?.startsWith("send_") && n.properties?.template) acc.add(n.properties.template);
    for (const b of n.branches ?? []) collectTemplateSlugs(b.nodes ?? [], acc);
  }
  return acc;
}

/**
 * Build a complete trigger payload for a workflow by merging the sample data of
 * every template it sends — so "Send test" always has all the variables (avoids
 * "missing variables" render failures), regardless of which test entry point.
 */
export async function getWorkflowTriggerData(ws: WorkspaceSlug, slug: string): Promise<Record<string, string>> {
  const wf = await getWorkflow(ws, slug);
  if (!wf.ok) return {};
  const tree = (wf.body as { tree?: { nodes?: WorkflowTreeNode[] } }).tree;
  const slugs = collectTemplateSlugs(tree?.nodes ?? []);
  const data: Record<string, string> = {};
  for (const tslug of slugs) {
    const mock = await call<MockDataBody>(ws, "v2", `template/${tslug}/mock_data/`);
    const payload = mock.ok ? mock.body.data?.payload : undefined;
    if (payload) Object.assign(data, payload);
  }
  return data;
}

export async function publishWorkflow(ws: WorkspaceSlug, slug: string, workflow: unknown) {
  const r = await call(ws, "v1", `workflow/${slug}/?commit=true&commit_message=${encodeURIComponent("Published from Keystone")}`, {
    method: "POST",
    body: JSON.stringify(normalizeWorkflow(workflow)),
  });
  return isNoChanges(r) ? { ok: true, status: 200, body: { status: "active" } } : r;
}

// Enable/disable a workflow = the Notifications admin "active/inactive" toggle.
// Fetch the live definition, flip is_enabled, re-publish. A disabled workflow
// stays in the list but doesn't run when its event fires (the PRD behaviour).
export async function setWorkflowEnabled(ws: WorkspaceSlug, slug: string, enabled: boolean): Promise<MgmtResult> {
  const wf = await getWorkflow(ws, slug);
  if (!wf.ok || !wf.body || typeof wf.body !== "object") return { ok: false, status: 404, body: {} };
  const body = wf.body as Record<string, unknown>;
  body.is_enabled = enabled;
  return publishWorkflow(ws, slug, body);
}

// The AI emits clean schema JSON; SuprSend wants a ref + schema_version on every
// node, a ref on every branch, and is_enabled on the workflow. Fill the gaps.
let refCounter = 0;
function ensureNodeRefs(nodes: Record<string, unknown>[]): void {
  for (const n of nodes) {
    if (!n.ref) n.ref = `n_${++refCounter}`;
    if (!n.schema_version) n.schema_version = "1";
    if (!n.properties) n.properties = {};
    const props = n.properties as Record<string, unknown>;
    // Multi-channel sends ALWAYS go to "all active channels of the template" (the
    // SuprSend default when no channel list is set). Pinning an explicit subset on
    // the node is fragile: it silently drifts from the template (a node pinned to
    // ["slack"] never sent email/inbox even though the template had them). The
    // template is the single source of truth for which channels exist; per-user
    // preferences then filter. So we drop any pinned channel list here.
    if (n.node_type === "send_multi_channel" && "channels" in props) {
      delete props.channels;
    }
    const branches = n.branches as Record<string, unknown>[] | undefined;
    if (Array.isArray(branches)) {
      for (const b of branches) {
        if (!b.ref) b.ref = `b_${++refCounter}`;
        if (Array.isArray(b.nodes)) ensureNodeRefs(b.nodes as Record<string, unknown>[]);
      }
    }
  }
}
function normalizeWorkflow(workflow: unknown): unknown {
  const w = JSON.parse(JSON.stringify(workflow)) as Record<string, unknown>;
  if (w.is_enabled === undefined) w.is_enabled = true;
  const tree = w.tree as { nodes?: Record<string, unknown>[] } | undefined;
  if (tree?.nodes) {
    refCounter = 0;
    ensureNodeRefs(tree.nodes);
  }
  return w;
}
