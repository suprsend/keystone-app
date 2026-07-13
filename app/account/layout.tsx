import { TopBar } from "@/components/app-shell/top-bar";
import { AppFooter } from "@/components/app-shell/app-footer";

// Account surface (the user's own settings). Same chrome as the rest of the app —
// top bar + grey page + footer — so Settings → Notifications opens as a real page
// (matching Accolade's Account section), not a modal.
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <TopBar />
      <main className="flex w-full flex-1 flex-col overflow-y-auto bg-[#f2f2f2] px-6 py-6 lg:px-8">
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
