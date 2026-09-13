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

function isNoChanges(r: MgmtResult): boolean {
  const body = r.body as { error_code?: string } | undefined;
  return r.status === 409 && body?.error_code === "no_changes_to_commit";
}


// ───────────────────────── Workflows (v1) ─────────────────────────

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
