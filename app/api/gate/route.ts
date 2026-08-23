// Unlocks the demo gate (see `proxy.ts`). Verifies the shared password and sets
// the cookie the proxy checks on every subsequent request.
import { NextResponse } from "next/server";

const COOKIE = "ks_demo";

async function expectedToken(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`keystone:${password}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: Request) {
  const configured = process.env.DEMO_PASSWORD;
  if (!configured) return NextResponse.json({ ok: true });

  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (password !== configured) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, await expectedToken(configured), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
