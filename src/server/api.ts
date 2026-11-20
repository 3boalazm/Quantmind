import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isISODate } from "@/lib/engine";
import { ConfirmError, OpError } from "@/lib/ops";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { isBook, today, type Book } from "./config";
import { NotConfiguredError } from "./db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function ok(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

/** A browser only sends Origin on cross-site or mutating requests; when present it must be ours. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Every data route calls this: signed-in session, and for writes a same-origin JSON request. */
export async function guard(request: Request, mutating = false): Promise<void> {
  const jar = await cookies();
  if (!(await verifySession(jar.get(SESSION_COOKIE)?.value))) throw new HttpError(401, "سجّل الدخول الأول.");
  if (mutating) assertSameOriginJson(request);
}

export function assertSameOriginJson(request: Request): void {
  if (!sameOrigin(request)) throw new HttpError(403, "طلب من مصدر غير مسموح.");
  const type = request.headers.get("content-type") ?? "";
  if (request.method !== "DELETE" && !type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "صيغة الطلب لازم تكون JSON.");
  }
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw new HttpError(400, "بيانات الطلب غير صالحة.");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "بيانات الطلب غير صالحة.");
  return data as Record<string, unknown>;
}

export function bookOf(value: unknown): Book {
  if (!isBook(value)) throw new HttpError(400, "الدفتر غير معروف.");
  return value;
}

/** A date for a new entry: valid, not in the future, not absurdly old. */
export function dayOf(value: unknown): string {
  const now = today();
  if (value === undefined || value === null || value === "") return now;
  if (!isISODate(value)) throw new HttpError(400, "التاريخ غير صالح.");
  if (value > now) throw new HttpError(400, "مينفعش تسجّل بتاريخ في المستقبل.");
  if (value < "2020-01-01") throw new HttpError(400, "التاريخ قديم جدًا.");
  return value;
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.message);
    if (error instanceof ConfirmError) {
      return NextResponse.json({ error: error.message, confirm: true }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof OpError) return fail(400, error.message);
    if (error instanceof NotConfiguredError) {
      return fail(503, "قاعدة البيانات لسه متربطتش. أضف Neon من تبويب Storage في Vercel وأعد النشر.");
    }
    console.error("api error", error);
    return fail(500, "حصل خطأ في الخادم. جرّب تاني.");
  }
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0].trim() : "") || request.headers.get("x-real-ip") || "local";
}
