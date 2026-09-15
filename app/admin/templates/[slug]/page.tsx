import { FileText } from "lucide-react";
import { getActiveWorkspace, hasWorkspaceKeys } from "@/lib/server/workspace";
import { getTemplate } from "@/lib/suprsend-mgmt";
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
  const { slug } = await params;
  const ws = await getActiveWorkspace();
  const meta = await getTemplate(ws.slug, slug);
  const name = meta.ok && meta.body.name ? meta.body.name : slug;

  // The Send-Test call requires the notification's preference CATEGORY (SuprSend
  // 400s with "category: This field is required" otherwise). The category lives on
  // the workflow that sends this template, so find the live workflow whose tree
  // sends it — templates created in the SuprSend dashboard work the same way. No
  // workflow sends it → no category is pre-filled.
  let category = "";
  if (hasWorkspaceKeys(ws)) {
    const configs = await getNotifConfig(ws.slug).catch(() => []);
    category = configs.find((c) => c.templates.includes(slug))?.category ?? "";
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
