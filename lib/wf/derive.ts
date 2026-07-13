// Derive a wf-engine.js model ({w,h,nodes,edges}) from a SuprSend workflow JSON.
// Layout = a single vertical spine (Trigger → …nodes… → Exit). branch_waituntil keeps
// its max-time branch ON the spine and peels the empty condition branch ("Responded")
// left to the shared Exit via a "stop" edge — exactly SuprSend's deadline-reminder shape.

export interface WfBranch {
  name?: string;
  ref?: string;
  is_default?: boolean;
  conditions?: unknown[];
  nodes?: WfNode[];
}
export interface WfNode {
  node_type: string;
  ref?: string;
  name?: string;
  properties?: Record<string, unknown>;
  branches?: WfBranch[];
}
export interface Workflow {
  slug: string;
  name: string;
  trigger_type?: string;
  category?: string;
  tree: { nodes: WfNode[] };
}

interface ModelNode {
  id: string;
  type: string;
  title: string;
  sub?: string;
  sub2?: string;
  gx: number;
  gy: number;
}
interface ModelEdge {
  from: string;
  to: string;
  kind: string;
  label?: string;
}
export interface WfModel {
  w: number;
  h: number;
  nodes: ModelNode[];
  edges: ModelEdge[];
}

const GX = 230; // left padding so empty "responded" branches can peel left to Exit
const START_Y = 30;
const STEP = 160;
const LABEL_GAP = 48; // extra drop below a Wait node so its branch label clears the next node

// Format a delay like SuprSend does: "2d" → "2 days", "30s" → "30 seconds".
function formatDelay(v: string): string {
  const m = v.match(/^(\d+)\s*([smhdw])$/i);
  if (!m) return v;
  const n = Number(m[1]);
  const unit = { s: "second", m: "minute", h: "hour", d: "day", w: "week" }[m[2].toLowerCase()] ?? "";
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

// Channel slug → display label, in a stable order so the node reads consistently.
const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  inbox: "Inbox",
  sms: "SMS",
  whatsapp: "WhatsApp",
  slack: "Slack",
};
const CHANNEL_ORDER = ["email", "inbox", "sms", "whatsapp", "slack"];
function channelLine(channels: unknown): string {
  if (!Array.isArray(channels)) return "";
  const seen = [...new Set(channels.map(String))]; // dedupe
  const ordered = seen.sort((a, b) => CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b));
  return ordered.map((c) => CHANNEL_LABEL[c] ?? c).join(" · ");
}

// SuprSend node_type → diagram type + the exact node NAME SuprSend shows (title),
// the channels line (sub — what you edit), and the template (sub2).
function describe(n: WfNode): { type: string; title: string; sub: string; sub2?: string } {
  const p = n.properties ?? {};
  switch (n.node_type) {
    case "send_multi_channel": {
      const chans = channelLine(p.channels);
      return {
        type: "multichannel",
        title: "Multi-Channel",
        sub: chans || "all channels",
        sub2: `template: ${String(p.template ?? "—")}`,
      };
    }
    case "send_smart_channel_routing": {
      const chans = channelLine(p.channels);
      return {
        type: "multichannel",
        title: "Smart Channel Routing",
        sub: chans || "best channel per user",
        sub2: `template: ${String(p.template ?? "—")}`,
      };
    }
    case "send_email":
      return { type: "email", title: "Email", sub: `template: ${String(p.template ?? "—")}` };
    case "send_inbox":
      return { type: "inbox", title: "In-App Inbox", sub: `template: ${String(p.template ?? "—")}` };
    case "delay":
      return { type: "delay", title: "Delay", sub: p.value ? formatDelay(String(p.value)) : "" };
    case "branch_waituntil":
      return { type: "wait", title: "Wait Until", sub: "conditions met or max wait" };
    case "httpapi_fetch":
      return { type: "fetch", title: "Fetch", sub: `stores ${String(p.output_key ?? "data")}` };
    case "branch":
      return { type: "branch", title: "Branch", sub: "one path runs based on data" };
    default:
      return { type: "transform", title: n.node_type, sub: "" };
  }
}

export function deriveWfModel(wf: Workflow): WfModel {
  const nodes: ModelNode[] = [];
  const edges: ModelEdge[] = [];
  let uid = 0;
  const next = () => `nd_${++uid}`;

  nodes.push({
    id: "trigger",
    type: "trigger",
    title: "Trigger",
    sub: `via ${(wf.trigger_type ?? "api").toUpperCase()}`,
    gx: GX,
    gy: START_Y,
  });

  // Walk a node list onto a spine. branch_waituntil: the condition branch (no
  // nodes) peels to Exit via a "stop" edge; the Max-time branch continues the
  // spine, shifted right (the SuprSend deadline-reminders shape).
  function walk(
    list: WfNode[],
    prev: string,
    y: number,
    gx: number,
    firstLabel: string | null,
  ): { prev: string; y: number } {
    list.forEach((n, i) => {
      const label = i === 0 ? firstLabel ?? undefined : undefined;
      if (n.node_type === "branch_waituntil") {
        const id = next();
        nodes.push({ id, type: "wait", title: "Wait Until", sub: "conditions met or max wait", gx, gy: y });
        edges.push({ from: prev, to: id, kind: "v", label });
        prev = id;
        y += STEP;

        const branches = n.branches ?? [];
        for (const b of branches.filter((br) => !br.is_default)) {
          if (!b.nodes || b.nodes.length === 0) {
            edges.push({ from: id, to: "exit", kind: "stop", label: b.name });
          }
        }
        const maxB = branches.find((br) => br.is_default);
        if (maxB?.nodes?.length) {
          // Max-time branch continues straight DOWN the spine (same gx) — SuprSend's
          // deadline-reminder shape. Only the empty condition branch peels off (above).
          // Add LABEL_GAP so the branch label (drawn on the wait→node edge) has room
          // and doesn't collide with the top of the node directly below it.
          const r = walk(maxB.nodes, id, y + LABEL_GAP, gx, maxB.name ?? null);
          prev = r.prev;
          y = r.y;
        } else if (maxB) {
          edges.push({ from: id, to: "exit", kind: "v", label: maxB.name });
        }
      } else {
        const id = next();
        const d = describe(n);
        nodes.push({ id, type: d.type, title: d.title, sub: d.sub, sub2: d.sub2, gx, gy: y });
        edges.push({ from: prev, to: id, kind: "v", label });
        prev = id;
        y += STEP;
      }
    });
    return { prev, y };
  }

  const end = walk(wf.tree?.nodes ?? [], "trigger", START_Y + STEP, GX, null);

  const exitGx = Math.min(...nodes.map((nd) => nd.gx)) + 80;
  nodes.push({ id: "exit", type: "exit", title: "Exit", sub: "", gx: exitGx, gy: end.y });
  edges.push({ from: end.prev, to: "exit", kind: "v" });

  const maxGx = Math.max(...nodes.map((nd) => nd.gx));
  return { w: maxGx + 250 + GX, h: end.y + 90, nodes, edges };
}
