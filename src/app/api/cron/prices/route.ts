import { fail, handle, ok } from "@/server/api";
import { today } from "@/server/config";
import { db } from "@/server/db";
import { backfillFx } from "@/server/lab";
import { fetchReference } from "@/server/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called once a day by Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`.
 * Without CRON_SECRET in the environment the endpoint stays closed.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return fail(503, "CRON_SECRET is not set");
    const given = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${secret}`;
    let mismatch = given.length ^ expected.length;
    for (let i = 0; i < expected.length; i++) mismatch |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
    if (mismatch !== 0) return fail(401, "unauthorized");
    const reference = await fetchReference(today());
    // past exchange rates the crypto paper books still lack; a failure here must not hide the daily pull
    const fx = await backfillFx(await db()).catch((error) => ({ filled: [], failed: { backfill: String(error).slice(0, 80) } }));
    return ok({ ...reference, fx_backfill: fx });
  });
}
