// Demo access gate. Keystone has no login of its own (see the security note in
// README.md), so a hosted demo needs *something* in front of every route — the
// token routes mint SuprSend JWTs for any caller. Set DEMO_PASSWORD on the
// deployment and the whole app sits behind one shared password; leave it unset
// and the gate is off, which is what local dev wants.
import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "ks_demo";

/** Cookie value = a hash of the password, so the cookie never carries the
 *  password itself and can only be produced by someone who knows it. */
async function expectedToken(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`keystone:${password}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function proxy(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;
  // The gate itself must stay reachable, or there is no way in.
  if (pathname === "/gate" || pathname === "/api/gate") return NextResponse.next();

  const token = request.cookies.get(COOKIE)?.value;
  if (token && token === (await expectedToken(password))) return NextResponse.next();

  // API callers get a status they can act on; page requests get the gate
  // rendered in place, so the original URL survives and a reload lands there.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Locked. Enter the demo password first." }, { status: 401 });
  }
  return NextResponse.rewrite(new URL("/gate", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
