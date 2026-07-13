// SuprSend message data (hub.suprsend.com /v1/message/, node SDK only).
// One fetch, shaped two ways:
//   • Executions — messages grouped by idempotency_key (one trigger = one run).
//   • Analytics  — funnel counts (sent → delivered → opened, plus failed).
// Each message carries idempotency_key, execution_id, status, channel,
// per-stage timestamps, and nested workflow/template objects.
import "server-only";
import type { Workspace } from "@/lib/workspaces";
import { suprsendClient as client, hasWorkspaceKeys, getActiveTenant } from "@/lib/server/workspace";
import { mockMessages } from "@/lib/mock";
import type { TenantId } from "@/lib/tenants";

// ───────────────────────── Normalized record ─────────────────────────

export interface MessageRecord {
  messageId: string;
  createdAt: string;
  updatedAt: string | null;
  triggeredAt: string | null;
  deliveredAt: string | null;
  seenAt: string | null;
  clickedAt: string | null;
  readAt: string | null;
  unreadAt: string | null;
  isRead: boolean;
  status: string;
  channel: string;
  idempotencyKey: string;
  executionId: string | null;
  nodeRef: string | null;
  recipientId: string;
  recipientEmail: string | null;
  workflowSlug: string | null;
  workflowName: string | null;
  templateName: string | null;
  templateVersion: number | null;
  vendorName: string | null;
  vendorNickname: string | null;
  tenantId: string | null;
  category: string | null;
  failureReason: string;
  failed: boolean;
}

interface RawMessage {
  message_id: string;
  created_at: string;
  updated_at?: string | null;
  triggered_at?: string | null;
  delivered_at?: string | null;
  seen_at?: string | null;
  clicked_at?: string | null;
  read_at?: string | null;
  unread_at?: string | null;
  is_read?: boolean;
  status?: string;
  channel?: string;
  idempotency_key?: string;
  execution_id?: string;
  failure_reason?: string;
  recipient?: { distinct_id?: string };
  workflow?: { slug?: string; name?: string; node_ref?: string };
  template?: { name?: string; version_no?: number };
  vendor?: { name?: string; nickname?: string };
  channel_identity?: { email?: string };
  tenant_id?: string;
  category?: string;
}

// SuprSend marks failures with several status strings: `failed`, `delivery_failed`,
// `failure_by_vendor`, `failure_by_app`.
export function isFailedStatus(s?: string): boolean {
  const t = (s ?? "").toLowerCase();
  return t === "failed" || t === "delivery_failed" || t.startsWith("failure_");
}

function normalize(m: RawMessage): MessageRecord {
  const status = m.status ?? "";
  return {
    messageId: m.message_id,
    createdAt: m.created_at,
    updatedAt: m.updated_at ?? null,
    triggeredAt: m.triggered_at ?? null,
    deliveredAt: m.delivered_at ?? null,
    seenAt: m.seen_at ?? null,
    clickedAt: m.clicked_at ?? null,
    readAt: m.read_at ?? null,
    unreadAt: m.unread_at ?? null,
    isRead: Boolean(m.is_read),
    status,
    channel: m.channel ?? "",
    idempotencyKey: m.idempotency_key ?? m.execution_id ?? m.message_id,
    executionId: m.execution_id ?? null,
    nodeRef: m.workflow?.node_ref ?? null,
    recipientId: m.recipient?.distinct_id ?? "",
    recipientEmail: m.channel_identity?.email ?? null,
    workflowSlug: m.workflow?.slug ?? null,
    workflowName: m.workflow?.name ?? null,
    templateName: m.template?.name ?? null,
    templateVersion: m.template?.version_no ?? null,
    vendorName: m.vendor?.name ?? null,
    vendorNickname: m.vendor?.nickname ?? null,
    tenantId: m.tenant_id ?? null,
    category: m.category ?? null,
    failureReason: m.failure_reason ?? "",
    failed: isFailedStatus(status) || Boolean(m.failure_reason),
  };
}

// Pull every message for the workspace, newest first, walking the cursor until
// SuprSend says there's no next page (capped so a busy account can't run away).
const PAGE = 100;
const MAX_PAGES = 10;

async function fetchAll(ws: Workspace): Promise<MessageRecord[]> {
  const c = client(ws);
  const out: MessageRecord[] = [];
  let after: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = (await c.messages.list({ limit: PAGE, ...(after ? { after } : {}) })) as {
      meta?: { has_next?: boolean; after?: string | null };
      results?: RawMessage[];
    };
    for (const m of res.results ?? []) out.push(normalize(m));
    if (!res.meta?.has_next || !res.meta?.after) break;
    after = res.meta.after;
  }
  return out;
}

// ───────────────────────── Executions ─────────────────────────

// Both Executions views (grouped runs + flat log) are derived on the client from
// this one flat list — same pattern as the analytics aggregate. Newest first.
export async function listMessageRecords(ws: Workspace, tenantId?: string): Promise<MessageRecord[]> {
  if (!hasWorkspaceKeys(ws)) {
    const tenant = (tenantId as TenantId) ?? (await getActiveTenant());
    const mock = mockMessages(ws.slug, tenant);
    const scoped = tenantId ? mock.filter((m) => m.tenantId === tenantId) : mock;
    return scoped.sort((a, b) => lastActivity(b) - lastActivity(a));
  }
  const messages = await fetchAll(ws);
  // Tenant isolation — Logs + Analytics only show the active tenant's messages.
  const scoped = tenantId ? messages.filter((m) => m.tenantId === tenantId) : messages;
  return scoped.sort((a, b) => lastActivity(b) - lastActivity(a));
}

function lastActivity(m: MessageRecord): number {
  const iso =
    m.readAt ?? m.clickedAt ?? m.seenAt ?? m.deliveredAt ?? m.triggeredAt ?? m.updatedAt ?? m.createdAt;
  return iso ? new Date(iso).getTime() : 0;
}

// Analytics aggregation (funnel + per-template/workflow breakdowns) is derived
// CLIENT-SIDE from the same `listMessageRecords` list — see `computeAnalytics` in
// `lib/message-display.ts` — so a channel filter just re-aggregates without a
// round-trip. No separate analytics endpoint.
