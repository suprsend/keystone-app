"use client";

import "@suprsend/react-editor/styles.css";
import { SuprSendTemplateProvider, TemplateEditor, type ChannelId } from "@suprsend/react-editor";

export default function EditorMount({
  workspaceUid,
  slug,
  channels,
  accessToken,
  recipient,
  primary,
  tenantId,
  notificationCategory,
  variantId,
}: {
  workspaceUid: string;
  slug: string;
  channels: string[];
  accessToken: string;
  recipient: string;
  primary: string;
  /** Keep null: only the master variant (tenant_id null) exists, so a real tenant
   *  makes the variant fetch 404 and the editor shows "Something went wrong". */
  tenantId: string | null;
  /** Preference-category slug — pre-fills the Send-Test "Notification Category".
   *  SuprSend requires it on test sends (400s without it). */
  notificationCategory?: string;
  /** Variant key = (variant_id, tenant_id, locale). The tenant's override has its
   *  own variant id ("1"/"2"…), resolved live — master is "default". */
  variantId: string;
}) {
  return (
    <SuprSendTemplateProvider
      workspaceUid={workspaceUid}
      templateSlug={slug}
      variantId={variantId}
      tenantId={tenantId}
      notificationCategory={notificationCategory}
      channels={channels as ChannelId[]}
      locale="en"
      conditions={[]}
      // Show the published LIVE version (templates are committed live). Every
      // tenant variant exists in live, so each tenant loads its own correctly.
      mode="live"
      accessToken={accessToken}
      recipientDistinctId={recipient}
      themeOverrides={primary ? { primary } : undefined}
    >
      <TemplateEditor />
    </SuprSendTemplateProvider>
  );
}
