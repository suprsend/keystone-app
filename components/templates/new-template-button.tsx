"use client";

import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Dummy "New template" button. Authoring new templates/notifications IS supported in
// SuprSend, but this example app intentionally doesn't expose the authoring flow —
// so the button is a placeholder that says so (product decision), not the functional
// AI-authoring dialog. The dialog component remains in the codebase, just unwired.
export function NewTemplateButton() {
  return (
    <Button
      onClick={() =>
        toast("Template authoring lives in SuprSend", {
          description:
            "Adding notifications & templates is supported in SuprSend — this demo app doesn’t include the authoring flow.",
        })
      }
    >
      <Sparkles className="size-4" /> New template
    </Button>
  );
}
