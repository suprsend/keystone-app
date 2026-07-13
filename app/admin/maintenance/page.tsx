import { Wrench } from "lucide-react";

export default function MaintenancePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <Wrench className="size-10 opacity-40" />
      <div>
        <p className="text-base font-medium text-foreground">Tasks</p>
        <p className="text-sm">Project tasks and gate deliverables live here in Accolade. This demo focuses on notifications.</p>
      </div>
    </div>
  );
}
