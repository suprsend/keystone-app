import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import jwt from "jsonwebtoken";
import { getActiveTenant, getActiveWorkspace, getWorkspaceSecrets, publicEnvPrefix } from "@/lib/server/workspace";

// ES256 subscriber JWT for the @suprsend/react Inbox SDK. The token is tenant-scoped
// so the feed only shows the active tenant's notifications.
export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const url = new URL(req.url);
    const distinctId = url.searchParams.get("distinct_id");
    if (!distinctId) {
      return NextResponse.json({ error: "distinct_id required" }, { status: 400 });
    }
    const tenant = await getActiveTenant(url.searchParams.get("tenant"));
    const { signingKeyB64, signingKeyId } = getWorkspaceSecrets(ws);

    const prefix = publicEnvPrefix(ws);
    const publicApiKey = process.env[`${prefix}_PUBLIC_KEY`];
    if (!publicApiKey) {
      return NextResponse.json({ error: "public key not configured" }, { status: 500 });
    }

    const privateKey = Buffer.from(signingKeyB64, "base64").toString("utf-8");
    const now = Math.floor(Date.now() / 1000);
    // scope the subscriber to the active tenant — the feed is tenant-scoped, and
    // must match the tenant_id our triggers send to.
    const token = jwt.sign(
      { entity_type: "subscriber", entity_id: distinctId, iat: now, exp: now + 60 * 60, scope: { tenant_id: tenant } },
      privateKey,
      { algorithm: "ES256", header: { alg: "ES256", typ: "JWT", kid: signingKeyId } },
    );

    return NextResponse.json({ token, distinctId, publicApiKey, tenant });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}
