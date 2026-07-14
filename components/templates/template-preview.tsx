"use client";

import * as React from "react";
import { Mail, Bell, MessageSquare, MessageCircle, Smartphone, Apple, Globe, ExternalLink } from "lucide-react";
import { TeamsIcon } from "@/components/icons/teams-icon";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppState } from "@/components/providers";

export interface TemplateDraft {
  slug: string;
  name: string;
  description?: string;
  email?: { subject: string; html: string };
  inbox?: { title: string; body: string; button?: { text: string; url: string } };
  sms?: { body: string };
  whatsapp?: { body: string };
  slack?: { blocks: Record<string, unknown>[] };
  androidpush?: { title: string; body: string; actionUrl?: string };
  iospush?: { title: string; body: string; actionUrl?: string };
  webpush?: { title: string; body: string; actionUrl?: string };
  sampleData?: Record<string, string>;
}

interface Brand {
  tenantName: string;
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
}

const CHANNELS = ["email", "inbox", "sms", "whatsapp", "slack", "androidpush", "iospush", "webpush"] as const;
const PUSH_META = {
  androidpush: { label: "Android", icon: Smartphone },
  iospush: { label: "iOS", icon: Apple },
  webpush: { label: "Web", icon: Globe },
} as const;

// Fetch the active workspace's tenant brand so {{$brand.*}} resolves to real
// values in the preview (SuprSend auto-injects these at send time from the tenant;
// the preview has to supply them itself or the email shows a broken logo + raw
// handlebars in the button colour).
function useBrand(): Brand | null {
  const { tenant } = useAppState();
  const [brand, setBrand] = React.useState<Brand | null>(null);
  React.useEffect(() => {
    let active = true;
    fetch("/api/brand", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (active && d.ok) setBrand(d.brand); })
      .catch(() => {});
    return () => { active = false; };
  }, [tenant]);
  return brand;
}

// Build the full variable map: tenant brand + recipient defaults + the template's
// own sample data. Everything a real send would inject, so the preview matches.
function buildVars(brand: Brand | null, sample?: Record<string, string>): Record<string, string> {
  const name = sample?.employee_name ?? sample?.name ?? "Alex Rivera";
  return {
    "$brand.logo": brand?.logo ?? "",
    "$brand.brand_name": brand?.tenantName || "Your Company",
    "$brand.primary_color": brand?.primaryColor || "#005288",
    "$brand.secondary_color": brand?.secondaryColor || "#111111",
    "$brand.tertiary_color": brand?.tertiaryColor || "#f5f5f5",
    "$recipient.name": name,
    "$recipient.role": sample?.role ?? "Team member",
    "$hosted_preference_url": "#preferences",
    ...sample,
  };
}

// Resolve {{ var }} / {{$brand.x}} / {{$recipient.x}} against the map. Unknown
// tokens are left visible so missing sample data is obvious while authoring.
function resolve(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, key) => {
    const v = vars[key.trim()];
    return v !== undefined && v !== "" ? v : m;
  });
}

/** Read-only rendered preview of a template's content across channels. */
export function TemplatePreview({ draft }: { draft: TemplateDraft }) {
  const brand = useBrand();
  const vars = React.useMemo(() => buildVars(brand, draft.sampleData), [brand, draft.sampleData]);
  const present = CHANNELS.filter((c) => draft[c]);
  const first = present[0];
  if (!first) return null;

  return (
    <div className="space-y-3">
      <Tabs defaultValue={first}>
        <TabsList>
          {draft.email && (
            <TabsTrigger value="email">
              <Mail className="size-3.5" /> Email
            </TabsTrigger>
          )}
          {draft.inbox && (
            <TabsTrigger value="inbox">
              <Bell className="size-3.5" /> Inbox
            </TabsTrigger>
          )}
          {draft.sms && (
            <TabsTrigger value="sms">
              <MessageSquare className="size-3.5" /> SMS
            </TabsTrigger>
          )}
          {draft.whatsapp && (
            <TabsTrigger value="whatsapp">
              <MessageCircle className="size-3.5" /> WhatsApp
            </TabsTrigger>
          )}
          {draft.slack && (
            <TabsTrigger value="slack">
              <TeamsIcon className="size-3.5" /> Teams
            </TabsTrigger>
          )}
          {(["androidpush", "iospush", "webpush"] as const).map((ch) =>
            draft[ch] ? (
              <TabsTrigger key={ch} value={ch}>
                {React.createElement(PUSH_META[ch].icon, { className: "size-3.5" })} {PUSH_META[ch].label}
              </TabsTrigger>
            ) : null,
          )}
        </TabsList>

        {draft.email && (
          <TabsContent value="email">
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border bg-muted/40 px-4 py-2.5">
                <div className="text-xs text-muted-foreground">Subject</div>
                <div className="text-sm font-medium">{resolve(draft.email.subject, vars)}</div>
              </div>
              <EmailFrame html={resolve(draft.email.html, vars)} />
            </div>
          </TabsContent>
        )}

        {draft.inbox && (
          <TabsContent value="inbox">
            <div className="flex gap-3 rounded-lg border border-border p-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bell className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 space-y-2">
                <div className="text-sm font-semibold">{resolve(draft.inbox.title, vars)}</div>
                <div className="text-sm text-muted-foreground">{resolve(draft.inbox.body, vars)}</div>
                {draft.inbox.button && (
                  <span
                    className="inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
                    style={{ background: vars["$brand.primary_color"] }}
                  >
                    {resolve(draft.inbox.button.text, vars)}
                  </span>
                )}
              </div>
            </div>
          </TabsContent>
        )}

        {draft.sms && (
          <TabsContent value="sms">
            <div className="rounded-lg border border-border p-4">
              <p className="whitespace-pre-wrap text-sm">{resolve(draft.sms.body, vars)}</p>
              <p className="mt-2 text-xs text-muted-foreground">{resolve(draft.sms.body, vars).length} characters</p>
            </div>
          </TabsContent>
        )}

        {draft.whatsapp && (
          <TabsContent value="whatsapp">
            <div className="rounded-lg border border-border bg-[#e7ffdb]/40 p-4">
              <p className="whitespace-pre-wrap text-sm">{resolve(draft.whatsapp.body, vars)}</p>
            </div>
          </TabsContent>
        )}

        {draft.slack && (
          <TabsContent value="slack">
            <SlackBlocks blocks={draft.slack.blocks} vars={vars} />
          </TabsContent>
        )}

        {(["androidpush", "iospush", "webpush"] as const).map((ch) => {
          const c = draft[ch];
          if (!c) return null;
          const Icon = PUSH_META[ch].icon;
          return (
            <TabsContent key={ch} value={ch}>
              <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-semibold">{resolve(c.title, vars)}</div>
                  <div className="text-sm text-muted-foreground">{resolve(c.body, vars)}</div>
                </div>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      <div className="flex flex-wrap gap-1.5">
        {present.map((c) => (
          <Badge key={c} variant="secondary">
            {c}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// Render the email HTML inside an isolated iframe so the template's own inline /
// table styles render exactly as they will in an inbox — no Tailwind `prose` or
// app CSS bleeding in. Auto-sizes to content; white "email client" canvas.
function EmailFrame({ html }: { html: string }) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(240);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0}body{background:#fff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;padding:24px}img{max-width:100%}a{color:inherit}</style></head><body>${html}</body></html>`;

  const onLoad = React.useCallback(() => {
    const body = ref.current?.contentDocument?.body;
    if (body) setHeight(Math.min(body.scrollHeight + 8, 900));
  }, []);

  return (
    <iframe
      ref={ref}
      title="Email preview"
      srcDoc={doc}
      onLoad={onLoad}
      className="w-full bg-white"
      style={{ height, border: "none" }}
      // allow-same-origin so we can measure content height; no allow-scripts, so
      // the (trusted, self-authored) email HTML renders but no script can run.
      sandbox="allow-same-origin"
    />
  );
}

// Minimal Block Kit renderer for the preview: section text, divider, action buttons.
function renderMrkdwn(text: string): React.ReactNode {
  const withLinks = text.replace(/<([^|>]+)\|([^>]+)>/g, "$2");
  const parts = withLinks.split(/(\*[^*]+\*)/g);
  return parts.map((p, i) =>
    p.startsWith("*") && p.endsWith("*") ? <strong key={i}>{p.slice(1, -1)}</strong> : <span key={i}>{p}</span>,
  );
}

// Slack's own Block Kit Builder renders the exact message — the authoritative
// preview (real Slack rendering needs the Slack app, this doesn't).
function blockKitBuilderUrl(blocks: Record<string, unknown>[], vars: Record<string, string>): string {
  const resolved = JSON.parse(resolve(JSON.stringify({ blocks }), vars));
  return `https://app.slack.com/block-kit-builder#${encodeURIComponent(JSON.stringify(resolved))}`;
}

function SlackBlocks({ blocks, vars }: { blocks: Record<string, unknown>[]; vars: Record<string, string> }) {
  const r = (s: string) => resolve(s, vars);
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border p-3">
        <div className="flex gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#4a154b] text-sm font-bold text-white">
            W
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">{vars["$brand.brand_name"] || "Keystone"}</span>
              <span className="rounded bg-muted px-1 text-[10px] font-medium uppercase text-muted-foreground">App</span>
            </div>
            {blocks.map((block, i) => {
              const type = block.type as string;
              if (type === "section" || type === "header") {
                const txt = r(((block.text as Record<string, unknown>)?.text as string) ?? "");
                return (
                  <div key={i} className={type === "header" ? "text-sm font-semibold" : "text-sm whitespace-pre-wrap"}>
                    {renderMrkdwn(txt)}
                  </div>
                );
              }
              if (type === "divider") return <hr key={i} className="border-border" />;
              if (type === "actions") {
                const elements = (block.elements as Record<string, unknown>[]) ?? [];
                return (
                  <div key={i} className="flex flex-wrap gap-2 pt-1">
                    {elements.map((el, j) => (
                      <span
                        key={j}
                        className="rounded border border-[#1264a3] bg-white px-3 py-1.5 text-xs font-semibold text-[#1264a3]"
                      >
                        {r(((el.text as Record<string, unknown>)?.text as string) ?? "Button")}
                      </span>
                    ))}
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      </div>
      <a
        href={blockKitBuilderUrl(blocks, vars)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Open in Block Kit Builder <ExternalLink className="size-3" />
      </a>
    </div>
  );
}
