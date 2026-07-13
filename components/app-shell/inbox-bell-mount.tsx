"use client";

import * as React from "react";
import { Bell } from "lucide-react";
import { SuprSendProvider, Inbox } from "@suprsend/react";

// In-app inbox as a header bell + popover (SuprSend's <Inbox>), themed to Accolade
// so it sits natively in the Wellspring chrome — the standard "bell → dropdown
// feed" pattern. Auth + tenant scoping mirror the full-page inbox.
const FONT = "var(--font-sans), ui-sans-serif, system-ui, sans-serif";
const STORES = [
  { storeId: "all", label: "All" },
  { storeId: "unread", label: "Unread", query: { read: false } },
];
const THEME = {
  bell: { color: "var(--muted-foreground)" },
  badge: { backgroundColor: "var(--brand-blue)", color: "#ffffff" },
  header: {
    container: { borderBottom: "1px solid var(--border)" },
    headerText: { fontFamily: FONT, color: "var(--foreground)", fontWeight: 600 },
    markAllReadText: { fontFamily: FONT, color: "var(--brand-blue)", fontWeight: 500 },
  },
  tabs: {
    color: "var(--brand-blue)",
    unselectedColor: "var(--muted-foreground)",
    bottomColor: "var(--brand-blue)",
    badgeColor: "var(--brand-blue)",
    badgeText: "#ffffff",
  },
  notificationsContainer: {
    noNotificationsText: { fontFamily: FONT, color: "var(--foreground)" },
    noNotificationsSubtext: { fontFamily: FONT, color: "var(--muted-foreground)" },
    loader: { color: "var(--brand-blue)" },
  },
  notification: {
    container: { borderBottom: "1px solid var(--border)", hoverBackgroundColor: "var(--accent)", unreadBackgroundColor: "transparent" },
    headerText: { fontFamily: FONT, color: "var(--foreground)", fontWeight: 600 },
    bodyText: { fontFamily: FONT, color: "var(--muted-foreground)", linkColor: "var(--brand-blue)" },
    createdOnText: { fontFamily: FONT, color: "var(--muted-foreground)" },
    subtext: { fontFamily: FONT, color: "var(--muted-foreground)" },
    unseenDot: { backgroundColor: "var(--brand-blue)" },
  },
};

// Custom trigger — a header icon button matching the Help button next to it.
function HeaderBell() {
  return (
    <span className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      <Bell className="size-5" />
    </span>
  );
}

export default function InboxBellMount({ actorId, tenant }: { actorId: string; tenant: string }) {
  const [auth, setAuth] = React.useState<{ token: string; publicApiKey: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/subscriber-token?distinct_id=${encodeURIComponent(actorId)}&tenant=${encodeURIComponent(tenant)}`,
        );
        const d = await res.json();
        if (active && d.token) setAuth({ token: d.token, publicApiKey: d.publicApiKey });
      } catch {
        /* leave the static bell on failure */
      }
    })();
    return () => {
      active = false;
    };
  }, [actorId, tenant]);

  if (!auth) return <HeaderBell />;
  return (
    <SuprSendProvider
      publicApiKey={auth.publicApiKey}
      distinctId={actorId}
      userToken={auth.token}
    >
      <Inbox
        tenantId={tenant}
        stores={STORES}
        theme={THEME}
        bellComponent={HeaderBell}
        popperPosition="bottom-end"
      />
    </SuprSendProvider>
  );
}
