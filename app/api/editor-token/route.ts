import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import jwt from "jsonwebtoken";
import { getActiveTenant, getActiveWorkspace, getWorkspaceSecrets } from "@/lib/server/workspace";
import { getProjectRoles } from "@/lib/server/users";

// ES256-signed JWT for @suprsend/react-editor (accessToken prop).
// The embedded editor ALWAYS requires a real tenant_id (verified: it 400s with
// "tenant_id missing" otherwise). So EVERY tenant — including `default` — edits
// its own per-tenant variant: variant_scope is { tenant_id }, and we resolve the
// variant id whose (id, tenant_id) pair exists (variant key = variant_id +
// tenant_id + locale). This mirrors BTS, which only ever scoped to real tenants.
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const { workspaceKey, signingKeyId, signingKeyB64 } = getWorkspaceSecrets(ws);
    const url = new URL(req.url);
    const tenant = await getActiveTenant(url.searchParams.get("tenant"));
    // Preview recipient = a REAL member of this project (its PM, else the first
    // subscriber) read from the project OBJECT, so the editor preview resolves
    // {{$recipient.*}}. Preview-only — does NOT affect how workflows are sent.
    const roles = await getProjectRoles(ws, tenant);
    const memberIds = Object.keys(roles);
    const pmId = memberIds.find((id) => roles[id] === "Project Manager");
    const recipient = url.searchParams.get("recipient") || pmId || memberIds[0] || "preview-user";
    // No per-tenant template variants exist on staging — every template has only its
    // MASTER variant (id "default", tenant_id null). So edit the master for everyone:
    // omit the tenant_id from the scope and load the "default" variant. `tenant` is
    // still resolved above (used for recipient/preview), but it does NOT scope the
    // editor variant.
    void tenant;
    const variant_scope = {};
    const variantId = "default";

    const privateKey = Buffer.from(signingKeyB64, "base64").toString("utf-8");
    const now = Math.floor(Date.now() / 1000);

    // DEMO ONLY: entity_id "*" grants edit access to EVERY template in the workspace,
    // and this route is open to any caller. In production, gate it to admins and pass
    // the specific template slug instead of "*".
    const payload = {
      workspace_uid: workspaceKey,
      entity_type: "template",
      entity_id: "*",
      iat: now,
      exp: now + 60 * 60,
      scope: {
        variant_scope,
        recipients: [{ distinct_id: recipient }],
      },
    };

    const accessToken = jwt.sign(payload, privateKey, {
      algorithm: "ES256",
      header: { alg: "ES256", typ: "JWT", kid: signingKeyId },
    });

    // No host override — the editor SDK uses its production default
    // (management-api.suprsend.com).
    return NextResponse.json({ accessToken, workspaceUid: workspaceKey, variantId, recipient });
  } catch (e) {
    const msg = errMsg(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
