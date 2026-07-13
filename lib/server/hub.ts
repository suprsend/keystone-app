// hub.suprsend.com access via the node SDK — user upsert ($email) + workflow trigger.
// Per-workspace credentials (workspace key + secret). The Management API can't set
// $email; only the SDK ingestion can.
import "server-only";
// `Event` is aliased — the bare name collides with the global `Event` that
// undici/axios reference internally (a CJS `const { Event }` shadow breaks them).
import { WorkflowTriggerRequest, Event as SuprsendEvent, SubscriberListBroadcast } from "@suprsend/node-sdk";
import type { Workspace } from "@/lib/workspaces";
import { suprsendClient as client } from "@/lib/server/workspace";

/** Trigger a workflow for one recipient with the given data payload. When `actor`
 * (the distinct_id of the person who performed the action) is given, it's passed
 * natively so workflow conditions can reference `$actor.*` — e.g. a self-action
 * check that skips notifying the actor. We never compute recipients in-app. */
export async function triggerWorkflow(
  ws: Workspace,
  workflow: string,
  distinctId: string,
  data: Record<string, unknown>,
  tenantId = "default",
  actor?: string,
) {
  const c = client(ws);
  const req = new WorkflowTriggerRequest({
    workflow,
    recipients: [{ distinct_id: distinctId }],
    tenant_id: tenantId,
    data,
    ...(actor ? { actor: { distinct_id: actor } } : {}),
  });
  return c.workflows.trigger(req);
}

/**
 * Track an event for a user. Any workflow whose `trigger_events` includes this
 * event name fires automatically with this user as the recipient — no direct
 * workflow trigger. This is how "add an employee → onboarding auto-sends" works:
 * we emit `employee_onboarded` and the event-triggered onboarding workflow runs.
 * SuprSend upper-cases event names on ingestion (we author the same way).
 */
export async function trackEvent(
  ws: Workspace,
  distinctId: string,
  eventName: string,
  properties: Record<string, unknown> = {},
  tenantId = "default",
) {
  const c = client(ws);
  const event = new SuprsendEvent(distinctId, eventName, properties, { tenant_id: tenantId });
  return c.track_event(event);
}

/**
 * LIST trigger — broadcast one template to every member of a subscriber list in a
 * single request. Per-recipient preferences still apply; {{$recipient.*}} resolves
 * per member. This is how "announce to the whole company" works.
 */
export async function broadcastToList(
  ws: Workspace,
  opts: { listId: string; template: string; category: string; channels?: string[]; data?: Record<string, unknown> },
  tenantId = "default",
) {
  const c = client(ws);
  const body: Record<string, unknown> = {
    list_id: opts.listId,
    template: opts.template,
    notification_category: opts.category,
    data: opts.data ?? {},
  };
  if (opts.channels?.length) body.channels = opts.channels;
  return c.subscriber_lists.broadcast(new SubscriberListBroadcast(body, { tenant_id: tenantId }));
}

/**
 * OBJECT trigger — trigger a workflow with an OBJECT as the recipient. SuprSend
 * fans the notification out to every user subscribed to that object (e.g. notify
 * everyone on a team). {{$recipient.*}} resolves per subscriber.
 */
export async function triggerObjectWorkflow(
  ws: Workspace,
  opts: { workflow: string; objectType: string; objectId: string; data?: Record<string, unknown>; actor?: string },
  tenantId = "default",
) {
  const c = client(ws);
  const req = new WorkflowTriggerRequest({
    workflow: opts.workflow,
    recipients: [{ object_type: opts.objectType, id: opts.objectId }],
    tenant_id: tenantId,
    data: opts.data ?? {},
    // The actor (who performed the action) is passed natively so the workflow's
    // self-action condition can skip them during object fan-out — no in-app filtering.
    ...(opts.actor ? { actor: { distinct_id: opts.actor } } : {}),
  });
  return c.workflows.trigger(req);
}

/**
 * Role-filtered fan-out — trigger a workflow for a specific set of users (the
 * project's members whose role matches the notification's recipients). The roles
 * come from the project OBJECT's subscriptions; this is the "objects resolve
 * recipients" pattern (per-recipient preferences still gate each send).
 */
export async function triggerUsers(
  ws: Workspace,
  workflow: string,
  distinctIds: string[],
  data: Record<string, unknown>,
  tenantId = "default",
) {
  const c = client(ws);
  const req = new WorkflowTriggerRequest({
    workflow,
    recipients: distinctIds.map((id) => ({ distinct_id: id })),
    tenant_id: tenantId,
    data,
  });
  return c.workflows.trigger(req);
}

/** List team objects (for the broadcast audience picker). */
export async function listTeams(ws: Workspace): Promise<{ id: string; name: string; subscribers: number }[]> {
  const res = (await client(ws).objects.list("team", { limit: 50 })) as { results?: { object_id?: string; id?: string; properties?: { name?: string }; subscriptions_count?: number }[] };
  return (res.results ?? []).map((o) => ({
    id: o.object_id ?? o.id ?? "",
    name: o.properties?.name ?? o.object_id ?? o.id ?? "",
    subscribers: o.subscriptions_count ?? 0,
  }));
}
