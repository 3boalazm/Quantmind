import { handle, ok } from "@/server/api";
import { cronRefusal } from "@/server/cron";
import { today } from "@/server/config";
import { db } from "@/server/db";
import { backfillFx } from "@/server/lab";
import { fetchReference } from "@/server/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called once a day by Vercel Cron (see `cronRefusal` for how it is checked). */
export async function GET(request: Request) {
  return handle(async () => {
    const refusal = cronRefusal(request);
    if (refusal) return refusal;
    const reference = await fetchReference(today());
    // past exchange rates the crypto paper books still lack; a failure here must not hide the daily pull
    const fx = await backfillFx(await db()).catch((error) => ({ filled: [], failed: { backfill: String(error).slice(0, 80) } }));
    return ok({ ...reference, fx_backfill: fx });
  });
}
