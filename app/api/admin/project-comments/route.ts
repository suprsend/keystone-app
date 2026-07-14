import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace, getActiveTenant } from "@/lib/server/workspace";
import { triggerWorkflow, triggerObjectWorkflow } from "@/lib/server/hub";
import { listUsers, getProjectRoles } from "@/lib/server/users";
import { getComments, addComment } from "@/lib/server/project-content";
import { getTenantPrefExtras } from "@/lib/server/tenant-prefs";

async function resolveTenant(body?: { tenant?: string }) {
  const t = body?.tenant;
  return typeof t === "string" && t ? t : await getActiveTenant();
}

// GET — the comment thread, member names (to label authors), and the project's members
// (for the @-mention picker — anyone on the project can be tagged).
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const tParam = new URL(req.url).searchParams.get("tenant");
    const tenant = tParam || (await getActiveTenant());
    const [comments, users, roles] = await Promise.all([getComments(ws, tenant), listUsers(ws), getProjectRoles(ws, tenant)]);
    const names: Record<string, string> = {};
    for (const u of users) names[u.distinctId] = u.name;
    const members = Object.keys(roles).map((id) => ({ distinctId: id, name: names[id] ?? id }));
    return NextResponse.json({ ok: true, comments, names, members });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

// POST — add a comment. Tagged and Comment Added are MUTUALLY EXCLUSIVE:
//  • with an @mention → Tagged on a Project (PHX-18695), to the mentioned person only.
//  • plain comment    → Comment Added (PHX-18701), to the project's TEAM MEMBERS (by
//    role), excluding the author. (Not PM / sponsor / process owner.)
export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const body = (await req.json()) as { tenant?: string; body?: string; mentionId?: string };
    const tenant = await resolveTenant(body);
    const text = (body.body ?? "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "Comment can't be empty" }, { status: 400 });

    const actor = (await cookies()).get("actor")?.value ?? "";
    if (!actor) {
      return NextResponse.json({ ok: false, error: "Switch to a user to comment." }, { status: 400 });
    }

    const mentionId = body.mentionId && body.mentionId !== actor ? body.mentionId : undefined;
    const comment = await addComment(ws, tenant, { authorId: actor, body: text, mentionId }, new Date().toISOString());

    const users = await listUsers(ws);
    // Admin is org-level (not in the project roster) — resolve its display name directly.
    const authorName = actor === "admin" ? "Admin" : (users.find((u) => u.distinctId === actor)?.name ?? actor);
    // Excluded distinct_ids (the "Except" condition) must be PASSED in the trigger
    // data so the workflow's condition node can filter them out. Fetched per category.
    const exceptOf = async (category: string) =>
      (await getTenantPrefExtras(ws.slug, tenant, category).catch(() => ({ except: [] as string[] }))).except ?? [];
    const payload = {
      project_id: tenant,
      project_link: `https://app.keystone.com/projects/${tenant}`,
      comment_author: authorName,
      actor_name: authorName,
      comment_body: text,
    };

    // A mention fires Tagged to the @mentioned person (a specific person the event
    // names — not a role filter). No Comment Added in that case.
    if (mentionId) {
      const except = await exceptOf("tagged-on-a-project");
      await triggerWorkflow(ws, "tagged-on-project", mentionId, { ...payload, except }, tenant, actor).catch(() => {});
      return NextResponse.json({ ok: true, comment, tagged: true });
    }

    // Plain comment → fire Comment Added on the project OBJECT. SuprSend fans out to
    // the subscribers; WHO actually gets it (PM + team, skip the author) is decided by
    // the workflow's conditions — NOT resolved here. We pass `actor` (the commenter)
    // so a self-action condition can skip them; role/except already filter the rest.
    const except = await exceptOf("comment-added");
    await triggerObjectWorkflow(
      ws,
      { workflow: "comment-added", objectType: "project", objectId: tenant, data: { ...payload, except }, actor },
      tenant,
    ).catch(() => {});
    return NextResponse.json({ ok: true, comment });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
