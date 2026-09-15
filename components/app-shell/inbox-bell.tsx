"use client";

import dynamic from "next/dynamic";
import { Bell } from "lucide-react";
import { useAppState, ADMIN_ACTOR } from "@/components/providers";

// The SuprSend SDK is browser-only — load the bell + popover client-side.
const InboxBellMount = dynamic(() => import("./inbox-bell-mount"), {
  ssr: false,
  loading: () => <BellPlaceholder />,
});

function BellPlaceholder() {
  return (
    <span className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      <Bell className="size-5" />
    </span>
  );
}

// In-app inbox bell for the header. The inbox is personal, so the live SuprSend feed
// only mounts for a real user. The Admin overseer has NO personal inbox — no bell is
// shown for Admin at all. The feed is project-scoped, so no project → no bell.
export function InboxBell() {
  const { actorId, tenant } = useAppState();
  if (!actorId || actorId === ADMIN_ACTOR || !tenant) return null;
  return <InboxBellMount key={`${tenant}:${actorId}`} actorId={actorId} tenant={tenant} />;
}
