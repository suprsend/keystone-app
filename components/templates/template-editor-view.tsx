"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronLeft, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppState } from "@/components/providers";

// Browser-only SDK → load client-side only.
const EditorMount = dynamic(() => import("@/components/templates/editor-mount"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

export function TemplateEditorView({
  slug,
  channels,
  name,
  category,
}: {
  slug: string;
  channels: string[];
  name: string;
  /** Preference-category slug — pre-fills the Send-Test "Notification Category"
   *  (required by SuprSend) so test sends don't 400. */
  category: string;
}) {
  const { tenant, activeWorkspace } = useAppState();
  // Editor accent = the customer's brand colour (Administer → Brand); "" leaves the editor's own theme.
  const accent = activeWorkspace?.accent ?? "";
  const [token, setToken] = React.useState<{ accessToken: string; workspaceUid: string; variantId: string; recipient: string } | null>(null);
  // Live channel set — re-fetched client-side (no-store) so a channel added moments
  // ago (e.g. via a workflow edit) always appears as a tab, never a stale payload.
  // Falls back to the server-passed `channels` for the first paint.
  const [liveChannels, setLiveChannels] = React.useState<string[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Clear the old token IMMEDIATELY (during render) so the editor never mounts
  // with a token scoped to the previous tenant (the cause of "Something went
  // wrong" on tenant switch — the JWT's variant_scope must match the tenantId
  // prop). The skeleton shows until the new, matching token arrives.
  const tokenKey = `${tenant}:${slug}`;
  const [seededTokenKey, setSeededTokenKey] = React.useState(tokenKey);
  if (seededTokenKey !== tokenKey) {
    setSeededTokenKey(tokenKey);
    setToken(null);
    setError(null);
  }

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/editor-token?tenant=${encodeURIComponent(tenant)}&slug=${encodeURIComponent(slug)}`);
        const d = await res.json();
        if (!active) return;
        if (d.accessToken) setToken({ accessToken: d.accessToken, workspaceUid: d.workspaceUid, variantId: d.variantId ?? "default", recipient: d.recipient ?? "preview-user" });
        else setError(d.error ?? "Couldn’t load the editor.");
      } catch {
        if (active) setError("Couldn’t reach the editor service.");
      }
    })();
    return () => {
      active = false;
    };
  }, [tenant, slug]);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/templates?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const d = await res.json();
        if (!active || !d.ok || !d.template) return;
        const present = ["email", "inbox", "sms", "whatsapp", "slack"].filter((c) => d.template[c]);
        if (present.length) setLiveChannels(present);
      } catch {
        // non-fatal — fall back to the server-passed channels
      }
    })();
    return () => {
      active = false;
    };
  }, [slug, tenant]);

  const editorChannels = liveChannels ?? channels;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/admin/templates"
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Templates
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">{name}</span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{slug}</code>
      </div>

      <div className="min-h-[78vh] flex-1 overflow-hidden rounded-lg border border-border">
        {error ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        ) : !token ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : (
          <EditorMount
            key={`${tenant}:${editorChannels.join(",")}`}
            workspaceUid={token.workspaceUid}
            slug={slug}
            channels={editorChannels}
            accessToken={token.accessToken}
            recipient={token.recipient}
            primary={accent}
            // MUST stay null: only the master variant (tenant_id null) exists, so a
            // real tenant here makes the variant fetch 404 → "Something went wrong".
            tenantId={null}
            notificationCategory={category}
            variantId={token.variantId}
          />
        )}
      </div>
    </div>
  );
}
