import { TopBar } from "@/components/app-shell/top-bar";
import { Sidebar } from "@/components/app-shell/sidebar";

// Workspace shell — same chrome as Administer (TopBar + left Sidebar + Footer).
// The Sidebar renders the Workspace nav group on these routes.
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
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
