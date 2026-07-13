"use client";

import * as React from "react";
import { toast } from "sonner";
import { Sparkles, AlertCircle, PenLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { TemplatePreview, type TemplateDraft } from "@/components/templates/template-preview";

export function TemplateDetailDialog({
  slug,
  open,
  onOpenChange,
  onChanged,
}: {
  slug: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        {open && slug ? (
          <DetailBody key={slug} slug={slug} onChanged={onChanged} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  slug,
  onChanged,
  onClose,
}: {
  slug: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = React.useState<TemplateDraft | null>(null);
  const [proposed, setProposed] = React.useState<TemplateDraft | null>(null);
  const [instruction, setInstruction] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/templates?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const d = await res.json();
        if (!active) return;
        if (d.ok) setCurrent(d.template);
        else setError(d.error ?? "Couldn’t load template.");
      } catch {
        if (active) setError("Couldn’t reach SuprSend.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  async function applyEdit() {
    if (!current || !instruction.trim()) return;
    setEditing(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "edit", template: current, instruction }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? "Edit failed.");
      else setProposed(data.template);
    } catch {
      setError("Couldn’t reach the AI author. Try again.");
    } finally {
      setEditing(false);
    }
  }

  async function publish() {
    const draft = proposed ?? current;
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
      toast.success("Template updated", { description: `${draft.name} is live.` });
      onClose();
      onChanged();
    } catch {
      setError("Couldn’t reach SuprSend. Try again.");
    } finally {
      setPublishing(false);
    }
  }

  const shown = proposed ?? current;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {shown?.name ?? "Template"}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{slug}</code>
        </DialogTitle>
        <DialogDescription>
          {proposed ? "Proposed change — review and publish, or discard." : "Edit the copy in plain English."}
        </DialogDescription>
      </DialogHeader>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : shown ? (
        <div className="space-y-4">
          <TemplatePreview draft={shown} />

          {!proposed && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <PenLine className="size-4" /> Edit with AI
              </div>
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. Make the tone more formal, or add a line about the benefits deadline."
                rows={2}
              />
              <Button size="sm" variant="outline" onClick={applyEdit} disabled={editing || !instruction.trim()}>
                <Sparkles className="size-3.5" /> {editing ? "Applying…" : "Apply change"}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {proposed && (
        <DialogFooter>
          <Button variant="outline" onClick={() => setProposed(null)} disabled={publishing}>
            Discard
          </Button>
          <Button onClick={publish} disabled={publishing}>
            {publishing ? "Publishing…" : "Publish change"}
          </Button>
        </DialogFooter>
      )}
    </>
  );
}
