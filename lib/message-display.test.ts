import { describe, it, expect } from "vitest";
import {
  activityBadge,
  runStatusBadge,
  computeAnalytics,
  humanizeNode,
  fmtDuration,
  timeAgo,
} from "@/lib/message-display";
import type { MessageRecord } from "@/lib/server/messages";

// Minimal MessageRecord factory — only the fields the display helpers read matter.
function msg(partial: Partial<MessageRecord>): MessageRecord {
  return {
    messageId: "m",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: null,
    triggeredAt: null,
    deliveredAt: null,
    seenAt: null,
    clickedAt: null,
    readAt: null,
    unreadAt: null,
    isRead: false,
    status: "queued",
    channel: "email",
    idempotencyKey: "k",
    executionId: null,
    nodeRef: null,
    recipientId: "r",
    recipientEmail: null,
    workflowSlug: null,
    workflowName: null,
    templateName: null,
    templateVersion: null,
    vendorName: null,
    vendorNickname: null,
    tenantId: null,
    category: null,
    failureReason: "",
    failed: false,
    ...partial,
  };
}

describe("activityBadge", () => {
  it("reports the furthest stage reached, with failure taking priority", () => {
    expect(activityBadge(msg({ failed: true, deliveredAt: "x" })).label).toBe("Failed");
    expect(activityBadge(msg({ readAt: "x" })).label).toBe("Read");
    expect(activityBadge(msg({ seenAt: "x", channel: "email" })).label).toBe("Opened");
    expect(activityBadge(msg({ seenAt: "x", channel: "inbox" })).label).toBe("Seen");
    expect(activityBadge(msg({ deliveredAt: "x" })).label).toBe("Delivered");
    expect(activityBadge(msg({ triggeredAt: "x" })).label).toBe("Sent");
    expect(activityBadge(msg({})).label).toBe("Queued");
  });
});

describe("runStatusBadge", () => {
  it("maps each run status to a label", () => {
    expect(runStatusBadge("delivered").label).toBe("All delivered");
    expect(runStatusBadge("partial").label).toBe("Partial failure");
    expect(runStatusBadge("failed").label).toBe("Failed");
    expect(runStatusBadge("in_progress").label).toBe("In progress");
  });
});

describe("computeAnalytics", () => {
  it("counts the funnel by timestamp presence and breaks down by channel/template/workflow", () => {
    const records = [
      msg({ channel: "email", templateName: "Welcome", workflowSlug: "wf1", workflowName: "Onboarding", deliveredAt: "x", seenAt: "y" }),
      msg({ channel: "email", templateName: "Welcome", workflowSlug: "wf1", workflowName: "Onboarding", deliveredAt: "x" }),
      msg({ channel: "inbox", templateName: "Alert", workflowSlug: "wf2", workflowName: "Security", failed: true }),
    ];
    const a = computeAnalytics(records);
    expect(a.overall).toEqual({ sent: 3, delivered: 2, opened: 1, failed: 1 });
    // sorted by volume — email (2) before inbox (1)
    expect(a.byChannel.map((b) => b.label)).toEqual(["email", "inbox"]);
    expect(a.byChannel[0]).toMatchObject({ sent: 2, delivered: 2, opened: 1 });
    expect(a.byTemplate.map((b) => b.label)).toEqual(["Welcome", "Alert"]);
    expect(a.byWorkflow[0]).toMatchObject({ label: "Onboarding", slug: "wf1", sent: 2 });
  });
});

describe("humanizeNode", () => {
  it("turns a node ref into a readable label", () => {
    expect(humanizeNode("send_benefits_reminder")).toBe("Benefits Reminder");
    expect(humanizeNode("delay_2d")).toBe("Delay 2d");
    expect(humanizeNode(null)).toBe("Step");
    expect(humanizeNode(undefined)).toBe("Step");
  });
});

describe("fmtDuration", () => {
  const base = "2024-01-01T00:00:00.000Z";
  const plus = (ms: number) => new Date(Date.parse(base) + ms).toISOString();

  it("formats elapsed time in adaptive units", () => {
    expect(fmtDuration(base, plus(500))).toBe("500ms");
    expect(fmtDuration(base, plus(1500))).toBe("1.5s");
    expect(fmtDuration(base, plus(120000))).toBe("2m");
  });

  it("returns empty for missing or negative spans", () => {
    expect(fmtDuration(base, null)).toBe("");
    expect(fmtDuration(null, base)).toBe("");
    expect(fmtDuration(plus(1000), base)).toBe("");
  });
});

describe("timeAgo", () => {
  it("returns empty for missing input", () => {
    expect(timeAgo(null)).toBe("");
    expect(timeAgo(undefined)).toBe("");
  });

  it("renders an old date in day units", () => {
    expect(timeAgo("2000-01-01T00:00:00.000Z")).toMatch(/d ago$/);
  });
});
