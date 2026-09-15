import { TopBar } from "@/components/app-shell/top-bar";
import { WorkspaceGuard } from "@/components/app-shell/workspace-guard";

// Projects view — a project-scoped surface accessible to Admin, PM, and members.
// The top bar carries the Project switcher + "Viewing as" (incl. Admin); role
// gating inside each page follows the viewer (Admin/PM see settings; others see
// only their own).
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceGuard>
      <div className="flex h-svh flex-col overflow-hidden">
        <TopBar />
        <main className="flex w-full flex-1 flex-col gap-6 overflow-y-auto bg-muted px-6 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </WorkspaceGuard>
  );
}
