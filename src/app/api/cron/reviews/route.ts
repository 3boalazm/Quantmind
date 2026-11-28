import { handle, ok } from "@/server/api";
import { cronRefusal } from "@/server/cron";
import { db } from "@/server/db";
import { pushReviewNotice } from "@/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Called once a day by Vercel Cron: pushes a notification to the phone when a review waits. */
export async function GET(request: Request) {
  return handle(async () => {
    const refusal = cronRefusal(request);
    if (refusal) return refusal;
    return ok(await pushReviewNotice(await db()));
  });
}
