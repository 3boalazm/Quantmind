import { NextResponse } from "next/server";
import { authConfigured, createSession, passwordMatches, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";
import { assertSameOriginJson, body, clientIp, fail, handle, HttpError } from "@/server/api";
import {
  clearFailures,
  db,
  LOGIN_MAX_FAILURES,
  LOGIN_MAX_FAILURES_GLOBAL,
  LOGIN_WINDOW_MINUTES,
  recentFailures,
  recordFailure,
} from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOriginJson(request);
    if (!authConfigured()) {
      return fail(503, "كلمة السر لسه متضبطتش. أضف المتغير APP_PASSWORD في إعدادات المشروع على Vercel وأعد النشر.");
    }
    const data = await body(request);
    const password = typeof data.password === "string" ? data.password : "";
    if (!password || password.length > 200) throw new HttpError(400, "اكتب كلمة السر.");

    // Attempts are counted in the database. Without it there is nothing to count with and nothing to
    // show after signing in either, so the door stays shut rather than open to unlimited guessing.
    const ip = clientIp(request);
    const q = await db();
    const [mine, everyone] = await Promise.all([recentFailures(q, ip), recentFailures(q, null)]);
    if (mine >= LOGIN_MAX_FAILURES || everyone >= LOGIN_MAX_FAILURES_GLOBAL) {
      return fail(429, `محاولات كتير غلط. استنى ${LOGIN_WINDOW_MINUTES} دقيقة وجرّب تاني.`);
    }
    if (!(await passwordMatches(password))) {
      await recordFailure(q, ip);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return fail(401, "كلمة السر غلط.");
    }
    await clearFailures(q, ip);

    const token = await createSession();
    if (!token) return fail(503, "كلمة السر لسه متضبطتش.");
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DAYS * 86_400,
    });
    return response;
  });
}
