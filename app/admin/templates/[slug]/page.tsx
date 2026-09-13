import { FileText } from "lucide-react";
import { getActiveWorkspace, hasWorkspaceKeys } from "@/lib/server/workspace";
import { getTemplate } from "@/lib/suprsend-mgmt";
import { categorySlugOf, getNotification, templateSlugOf, workflowSlugOf } from "@/lib/notifications";
import { getNotifConfig } from "@/lib/server/notif-recipients";
import { TemplateEditorView } from "@/components/templates/template-editor-view";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

// Always render fresh — a channel added moments ago (e.g. via a workflow edit) must
// show up in the editor's tab list immediately, never a stale cached payload.
export const dynamic = "force-dynamic";

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  // A notification id may differ from its template slug (comment-added →
  // comment-added-batched); resolve so the URL loads the real template.
  const slug = templateSlugOf(rawSlug);
  const ws = await getActiveWorkspace();
  const meta = await getTemplate(ws.slug, slug);
  const name = meta.ok && meta.body.name ? meta.body.name : slug;

  // The Send-Test call requires the notification's preference CATEGORY (SuprSend
  // 400s with "category: This field is required" otherwise). The category lives on
  // the workflow that sends this template, so resolve it from the live workflow
  // list first — that way templates created in the SuprSend dashboard (never in
  // this repo) get the right category too. A workflow matches when its slug equals
  // this template's slug directly, or through the two known divergences
  // (comment-added → comment-added-batched, task-upcoming → tasks-upcoming).
  let category = "";
  if (hasWorkspaceKeys(ws)) {
    const configs = await getNotifConfig(ws.slug).catch(() => []);
    const match = configs.find(
      (c) => c.slug === rawSlug || templateSlugOf(c.slug) === slug || c.slug === workflowSlugOf(rawSlug),
    );
    if (match?.category) category = match.category;
  }
  if (!category) {
    // No live match (or no keys): derive from the static catalog's notification
    // NAME, falling back to the slug itself for notifications that live only on
    // SuprSend (e.g. budget-alert, where slug == category).
    const notif = getNotification(ws.slug, rawSlug);
    category = notif ? categorySlugOf(notif.name) : rawSlug;
  }

  // The embedded editor needs live SuprSend keys. Without them, show a graceful
  // card instead of mounting an editor that can't load.
  if (!hasWorkspaceKeys(ws)) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PageHeader title={name} description="Email & in-app content for this notification." />
        <EmptyState
          icon={FileText}
          title="Editing needs this customer's SuprSend keys"
          description="Connect this customer's SuprSend keys to edit live content. Keys are added after setup."
        />
      </div>
    );
  }

  const channels = meta.ok && meta.body.enabled_channels ? meta.body.enabled_channels : [];
  return <TemplateEditorView slug={slug} channels={channels} name={name} category={category} />;
}
