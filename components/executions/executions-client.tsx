"use client";

import * as React from "react";
import { Activity, RefreshCw } from "lucide-react";
import type { MessageRecord } from "@/lib/server/messages";
import { useAppState } from "@/components/providers";
import { useResource } from "@/lib/use-resource";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MessagesTable } from "@/components/executions/messages-table";

// Remount per workspace for a fresh fetch + skeleton (mirrors templates-client).
export function ExecutionsClient() {
  const { tenant } = useAppState();
  return <ExecutionsBody key={tenant} />;
}

function ExecutionsBody() {
  const { data: messages, error, loading, reload } = useResource(
    "/api/executions",
    (d) => d.messages as MessageRecord[],
    "Couldn’t load executions.",
  );
  const [refreshing, setRefreshing] = React.useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const fresh = !loading;

  return (
    <>
      <PageHeader
        title="Executions"
        description="Every notification sent — a filterable message log."
        actions={
          fresh && (messages?.length ?? 0) > 0 ? (
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      {!fresh ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : (messages?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Activity}
          title="No messages yet"
          description="Trigger a workflow with “Send test” and each notification shows up here in the message log."
        />
      ) : (
        <MessagesTable messages={messages!} />
      )}
    </>
  );
}
