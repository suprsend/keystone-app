import { TopBar } from "@/components/app-shell/top-bar";
import { Sidebar } from "@/components/app-shell/sidebar";

// The left panel (Sidebar) renders only on the Administer settings pages
// (Preferences / Templates / Brand / Logs) — it returns null elsewhere (Dashboard,
// Workspace Data), so those stay full-width.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
