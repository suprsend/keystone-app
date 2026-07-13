// Loads SuprSend's official skill references (copied from github.com/suprsend/skills)
// so the AI authors produce schema-correct output instead of guessing.
import "server-only";
import fs from "fs";
import path from "path";

function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(process.cwd(), "lib/ai/skills", dir, `${file}.md`), "utf8");
}

let workflowCache: string | null = null;
let templateCache: string | null = null;

/** Full workflow node schema: structure, delivery, delay, wait-until, branch. */
export function workflowSkill(): string {
  if (!workflowCache) {
    workflowCache = ["workflow-schema-guide", "node-delivery", "node-delay", "node-wait-until", "node-branch"]
      .map((f) => read("workflow", f))
      .join("\n\n---\n\n");
  }
  return workflowCache;
}

/** Channel content schemas (email, inbox, sms, whatsapp, slack) + jsonnet syntax. */
export function templateSkill(): string {
  if (!templateCache) {
    templateCache = [
      "template-schema-guide",
      "channel-email",
      "channel-inbox",
      "channel-sms",
      "channel-whatsapp",
      "channel-slack",
      "jsonnet-syntax",
    ]
      .map((f) => read("template", f))
      .join("\n\n---\n\n");
  }
  return templateCache;
}
