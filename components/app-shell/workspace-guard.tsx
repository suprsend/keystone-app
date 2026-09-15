import { Building2 } from "lucide-react";
import { listWorkspaces } from "@/lib/server/workspace";
import { errMsg } from "@/lib/server/http";
import { EmptyState } from "@/components/shared/empty-state";

// Renders the app only when at least one SuprSend workspace is connected (keys in the
// env AND the workspace exists in the account). Otherwise an empty state says what's missing.
export async function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  let error = "";
  let count = 0;
  try {
    count = (await listWorkspaces()).length;
  } catch (e) {
    error = errMsg(e);
  }
  if (count > 0) return children;
  return (
    <main className="flex h-svh flex-col p-6">
      <EmptyState
        icon={Building2}
        title="No workspace connected"
        description={
          error ||
          "Add a SuprSend workspace's keys to .env.local (see the README's Getting started) and restart the app."
        }
      />
    </main>
  );
}
