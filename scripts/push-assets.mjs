// Push the notification ASSETS in suprsend/ (preference categories, templates,
// workflows) to one or more SuprSend workspaces — a thin wrapper around SuprSend's
// own CLI (`npx suprsend`), which defines the file layout suprsend/ follows.
// Run: node --env-file=.env.local scripts/push-assets.mjs [workspace…] [--draft] [--dry-run]
//
//   workspace…   workspace slugs to push to (default: acme globex)
//   --draft      stage changes as drafts instead of committing them live
//   --dry-run    print what would be pushed without changing anything
//
// The wrapper exists ONLY to loop the three asset types over both demo workspaces
// in dependency order (a workflow references its template and category). Each demo
// asset is plain data in suprsend/ — inspect it there, push it with this wrapper or
// with `npx suprsend … push -w <workspace>` directly, or ignore it and build your
// own in the SuprSend dashboard; the app renders whatever your account holds.
//
// Re-run behaviour: pushing OVERWRITES the remote version of each asset with the
// local files (the CLI does not merge). Templates are where that bites — a re-push
// resets edits made by hand in the SuprSend editor. Workflows are safe to re-push
// by design: the files hold static structure only, and every value a human tunes
// (role, except, include, the cost threshold) lives on the preference category and
// its tenant/user overrides, which the workflow conditions only read. To bring
// dashboard edits INTO the repo instead, use `npx suprsend template pull` etc.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const workspaces = args.filter((a) => !a.startsWith("--"));
if (workspaces.length === 0) workspaces.push("acme", "globex");

const dryRun = flags.includes("--dry-run");
const commit = !flags.includes("--draft") && !dryRun;

if (!process.env.SUPRSEND_SERVICE_TOKEN) {
  console.error("✗ SUPRSEND_SERVICE_TOKEN is not set — run via: node --env-file=.env.local scripts/push-assets.mjs");
  process.exit(1);
}

// Dependency order: a workflow references its template and preference category.
const PUSHES = [
  ["category", []],
  ["template", []],
  ["workflow", []],
];

for (const ws of workspaces) {
  console.log(`\n=== ${ws} ===`);
  for (const [type, extra] of PUSHES) {
    const cmd = [
      "-y", "suprsend", type, "push", "-w", ws,
      ...(dryRun ? ["--dry-run"] : []),
      ...(commit ? ["--commit", "-F", "--commit-message", "Keystone reference kit"] : []),
      ...extra,
    ];
    console.log(`\n→ suprsend ${type} push -w ${ws}${dryRun ? " --dry-run" : commit ? " --commit" : " (draft)"}`);
    const r = spawnSync("npx", cmd, { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`✗ ${type} push failed for ${ws} (exit ${r.status}) — stopping.`);
      process.exit(r.status ?? 1);
    }
  }
}
console.log("\nDone.");
