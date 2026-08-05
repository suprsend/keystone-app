// Make the per-category "Except" control work when the except list is EMPTY.
//
// Every workflow gates delivery with a block like
//   AND[ role CONTAINS …, (cost > …), except NOT_CONTAINS $recipient.distinct_id ]
// `NOT_CONTAINS` does not evaluate true against an empty or unset except list — it
// fails, so the whole AND fails and nobody passes. With except empty (the common
// default) that means no notification at all.
//
// The fix: for every block carrying `except NOT_CONTAINS`, add a SIBLING OR-block
// identical to it but with that one arg swapped to `except EMPTY`. Top-level blocks
// are OR'd, so a recipient passes if
//   (role/cost gates AND except NOT_CONTAINS them)  OR  (same gates AND except EMPTY).
// Populated except → the first branch suppresses; empty except → the second delivers.
//
// Idempotent: a workflow that already has an `except EMPTY` arg is left untouched.
// Workflow change only — no app change.
//
//   node --env-file=.env.local scripts/ensure-except-empty-branch.mjs all
//   APPLY=1 node --env-file=.env.local scripts/ensure-except-empty-branch.mjs all
//   (arg: acme | globex | all — default all; dry run unless APPLY=1)

const MGMNT = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com").replace(/\/$/, "");
const TOKEN = process.env.SUPRSEND_SERVICE_TOKEN;
const APPLY = process.env.APPLY === "1";
const WS = {
  acme: process.env.SUPRSEND_ACME_WORKSPACE_KEY,
  globex: process.env.SUPRSEND_GLOBEX_WORKSPACE_KEY,
};
const hdr = { Authorization: `ServiceToken ${TOKEN}`, "Content-Type": "application/json" };

const EMPTY_ARG = { op: "EMPTY", value: "", variable: "properties.except", variable_ns: "$category" };
const argsOf = (b) => b.expression_v1?.args ?? [];
const isExceptNC = (a) => a.op === "NOT_CONTAINS" && a.variable === "properties.except";
const isExceptEmpty = (a) => a.op === "EMPTY" && a.variable === "properties.except";

const names = (process.argv[2] ?? "all") === "all" ? Object.keys(WS) : [process.argv[2]];
let totalFixed = 0;
for (const name of names) {
  const key = WS[name];
  if (!key) { console.log(`!! no workspace key for ${name} — skip`); continue; }
  console.log(`\n==== ${name} ${APPLY ? "(APPLY)" : "(dry run)"} ====`);

  const list = await (await fetch(`${MGMNT}/v1/${key}/workflow/?mode=live&limit=100`, { headers: hdr })).json();
  const slugs = (list.results ?? []).map((w) => w.workflow_slug ?? w.slug).filter(Boolean);

  for (const slug of slugs) {
    const w = await (await fetch(`${MGMNT}/v1/${key}/workflow/${slug}/?mode=live`, { headers: hdr, cache: "no-store" })).json();
    const blocks = (w.conditions ?? []).slice();

    // Idempotent: already has an empty-except branch → nothing to do.
    if (blocks.some((b) => argsOf(b).some(isExceptEmpty))) {
      console.log(`  ${slug.padEnd(22)} already has except EMPTY — skip`);
      continue;
    }

    // Clone every block that gates on `except NOT_CONTAINS`, swapping that arg to EMPTY.
    const added = [];
    for (const b of blocks.filter((b) => argsOf(b).some(isExceptNC))) {
      const clone = JSON.parse(JSON.stringify(b));
      clone.expression_v1.args = clone.expression_v1.args.map((a) => (isExceptNC(a) ? { ...EMPTY_ARG } : a));
      added.push(clone);
    }

    if (!added.length) {
      console.log(`  ${slug.padEnd(22)} no except NOT_CONTAINS block — skip`);
      continue;
    }

    const newBlocks = [...blocks, ...added];
    console.log(`  ${slug.padEnd(22)} + ${added.length} empty-except OR-block(s)`);
    totalFixed++;

    if (APPLY) {
      const body = {
        name: w.name, description: w.description, category: w.category, tags: w.tags,
        trigger_type: w.trigger_type, trigger_events: w.trigger_events,
        conditions: newBlocks, tree: w.tree,
      };
      const r = await fetch(
        `${MGMNT}/v1/${key}/workflow/${slug}/?commit=true&commit_message=${encodeURIComponent("add empty-except OR-branch so Except works when list is empty")}`,
        { method: "POST", headers: hdr, body: JSON.stringify(body) },
      );
      console.log(`      POST -> HTTP ${r.status} ${r.ok ? "OK" : (await r.text()).slice(0, 200)}`);
    }
  }
}
console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"}: ${totalFixed} workflow(s) need the empty-except branch.`);
