import { handle, ok } from "@/server/api";
import { cronRefusal } from "@/server/cron";
import { today } from "@/server/config";
import { fetchReference } from "@/server/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called once a day by Vercel Cron (see `cronRefusal` for how it is checked). */
export async function GET(request: Request) {
  return handle(async () => {
    const refusal = cronRefusal(request);
    if (refusal) return refusal;
    return ok(await fetchReference(today()));
  });
}
