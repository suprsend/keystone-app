import { AccountNav } from "@/components/app-shell/account-nav";
import { UserChannelSettings } from "@/components/app-shell/user-channel-settings";

// Account → Notifications, as a full page (mirrors Accolade's Account section with a
// left sub-nav). The user's own per-category channel settings live in the panel.
export default function AccountNotificationsPage() {
  return (
    <div className="mx-auto flex w-full gap-6">
      <AccountNav active="notifications" />
      <section className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose how you’re notified for each category.</p>
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Dummy screen. Will be functional with the sub-tenants feature.
        </div>
        <div className="mt-5">
          <UserChannelSettings />
        </div>
      </section>
    </div>
  );
}
