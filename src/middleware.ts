import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/** Everything is private except the login screen, the login call, the cron hook and static files. */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    return signedIn ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (pathname === "/api/auth/login" || pathname.startsWith("/api/cron/")) return NextResponse.next();
  if (signedIn) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "سجّل الدخول الأول." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|images/|favicon.ico|manifest.webmanifest|sw.js|offline.html).*)"],
};
