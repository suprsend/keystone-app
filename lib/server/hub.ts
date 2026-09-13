// hub.suprsend.com access via the node SDK — user upsert ($email) + workflow trigger.
// Per-workspace credentials (workspace key + secret). The Management API can't set
// $email; only the SDK ingestion can.
import "server-only";
// `Event` is aliased — the bare name collides with the global `Event` that
// undici/axios reference internally (a CJS `const { Event }` shadow breaks them).
import { WorkflowTriggerRequest, Event as SuprsendEvent } from "@suprsend/node-sdk";
import type { Workspace } from "@/lib/workspaces";
import { suprsendClient as client } from "@/lib/server/workspace";

/** Trigger a workflow for one recipient with the given data payload.
 * We never compute recipients in-app. */
export async function triggerWorkflow(
  ws: Workspace,
  workflow: string,
  distinctId: string,
  data: Record<string, unknown>,
  tenantId = "default",
) {
  const c = client(ws);
  const req = new WorkflowTriggerRequest({
    workflow,
    recipients: [{ distinct_id: distinctId }],
    tenant_id: tenantId,
    data,
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
 * OBJECT trigger — trigger a workflow with an OBJECT as the recipient. SuprSend
 * fans the notification out to every user subscribed to that object (e.g. notify
 * everyone on a team). {{$recipient.*}} resolves per subscriber.
 */
export async function triggerObjectWorkflow(
  ws: Workspace,
  opts: { workflow: string; objectType: string; objectId: string; data?: Record<string, unknown> },
  tenantId = "default",
) {
  const c = client(ws);
  const req = new WorkflowTriggerRequest({
    workflow: opts.workflow,
    recipients: [{ object_type: opts.objectType, id: opts.objectId }],
    tenant_id: tenantId,
    data: opts.data ?? {},
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

