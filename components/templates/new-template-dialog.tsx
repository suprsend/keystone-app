"use client";

import * as React from "react";
import { toast } from "sonner";
import { Mail, Bell, MessageSquare, MessageCircle, Smartphone, Apple, Globe, Sparkles, AlertCircle, PenLine, Check } from "lucide-react";
import { TeamsIcon } from "@/components/icons/teams-icon";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TemplatePreview, type TemplateDraft } from "@/components/templates/template-preview";

const EXAMPLES = [
  "A welcome message for new hires on their first day.",
  "Remind employees to complete their quarterly engagement survey before Friday.",
  "Celebrate an employee's work anniversary with a recognition note.",
];

export function NewTemplateDialog({ onPublished }: { onPublished: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [email, setEmail] = React.useState(true);
  const [inbox, setInbox] = React.useState(true);
  const [sms, setSms] = React.useState(false);
  const [whatsapp, setWhatsapp] = React.useState(false);
  const [slack, setSlack] = React.useState(false);
  const [androidpush, setAndroidpush] = React.useState(false);
  const [iospush, setIospush] = React.useState(false);
  const [webpush, setWebpush] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [draft, setDraft] = React.useState<TemplateDraft | null>(null);
  const [refineText, setRefineText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Grouped so all eight channels read clearly — In-app, Messaging, Push.
  const channelGroups = [
    {
      group: "In-app",
      channels: [
        { key: "email", label: "Email", icon: Mail, on: email, set: setEmail },
        { key: "inbox", label: "Inbox", icon: Bell, on: inbox, set: setInbox },
      ],
    },
    {
      group: "Messaging",
      channels: [
        { key: "sms", label: "SMS", icon: MessageSquare, on: sms, set: setSms },
        { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, on: whatsapp, set: setWhatsapp },
        { key: "slack", label: "Teams", icon: TeamsIcon, on: slack, set: setSlack },
      ],
    },
    {
      group: "Push",
      channels: [
        { key: "androidpush", label: "Android", icon: Smartphone, on: androidpush, set: setAndroidpush },
        { key: "iospush", label: "iOS", icon: Apple, on: iospush, set: setIospush },
        { key: "webpush", label: "Web", icon: Globe, on: webpush, set: setWebpush },
      ],
    },
  ];
  const allToggles = channelGroups.flatMap((g) => g.channels);
  const anyChannel = allToggles.some((c) => c.on);

  function reset() {
    setDescription("");
    setEmail(true);
    setInbox(true);
    setSms(false);
    setWhatsapp(false);
    setSlack(false);
    setAndroidpush(false);
    setIospush(false);
    setWebpush(false);
    setDraft(null);
    setRefineText("");
    setError(null);
    setGenerating(false);
    setPublishing(false);
  }

  async function refine() {
    if (!draft || !refineText.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "edit", template: draft, instruction: refineText }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? "Couldn’t apply the change.");
      else {
        setDraft(data.template);
        setRefineText("");
      }
    } catch {
      setError("Couldn’t reach the AI author. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    setDraft(null);
    try {
      const channels = allToggles.filter((c) => c.on).map((c) => c.key);
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "generate", description, channels }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? "Generation failed.");
      else setDraft(data.template);
    } catch {
      setError("Couldn’t reach the AI author. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function publish() {
    if (!draft) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "publish", template: draft }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(typeof data.body === "object" ? JSON.stringify(data.body) : (data.error ?? "Publish failed."));
        return;
      }
      toast.success("Template published", { description: `${draft.name} is live.` });
      setOpen(false);
      reset();
      onPublished();
    } catch {
      setError("Couldn’t reach SuprSend. Try again.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Sparkles className="size-4" /> New template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>
            Describe the message in plain English. The AI author drafts the copy for the channels you pick.
          </DialogDescription>
        </DialogHeader>

        {!draft && (
          <div className="space-y-4">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. A welcome message for new hires on their first day."
              rows={3}
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setDescription(ex)}
                  className="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {ex.length > 42 ? ex.slice(0, 42) + "…" : ex}
                </button>
              ))}
            </div>
            <div className="space-y-3 rounded-lg border border-border px-4 py-3.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Channels</span>
                <span className="text-xs text-muted-foreground">Tap to pick where this message goes</span>
              </div>
              <div className="space-y-3">
                {channelGroups.map((g) => (
                  <div key={g.group} className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</div>
                    <div className="flex flex-wrap gap-2">
                      {g.channels.map((c) => {
                        const Icon = c.icon;
                        return (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => c.set(!c.on)}
                            aria-pressed={c.on}
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                              c.on
                                ? "border-primary bg-primary/10 font-medium text-foreground"
                                : "border-border text-muted-foreground hover:bg-muted/60",
                            )}
                          >
                            <Icon className="size-3.5" /> {c.label}
                            {c.on && <Check className="size-3.5 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {draft && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{draft.name}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{draft.slug}</code>
              </div>
              <TemplatePreview draft={draft} />
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <PenLine className="size-4" /> Not quite right? Refine it
              </div>
              <Textarea
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                placeholder="e.g. make it shorter, warmer, and mention the start date."
                rows={2}
              />
              <Button size="sm" variant="outline" onClick={refine} disabled={generating || !refineText.trim()}>
                <Sparkles className="size-3.5" /> {generating ? "Refining…" : "Refine"}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <DialogFooter>
          {!draft ? (
            <Button onClick={generate} disabled={generating || !description.trim() || !anyChannel}>
              {generating ? "Generating…" : "Generate"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setDraft(null)} disabled={publishing}>
                Back
              </Button>
              <Button onClick={publish} disabled={publishing}>
                {publishing ? "Publishing…" : "Publish"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
