import { guard, handle, ok } from "@/server/api";
import { today } from "@/server/config";
import { fetchReference } from "@/server/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pull the reference levels now (the daily cron does the same thing). */
export async function POST(request: Request) {
  return handle(async () => {
    await guard(request, true);
    return ok(await fetchReference(today()));
  });
}
