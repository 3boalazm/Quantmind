import { MAX_NEXT_DAYS, RESULTS, nextDue, type ReviewResult } from "@/lib/followup";
import { OpError } from "@/lib/ops";
import { body, dayOf, guard, handle, HttpError, ok } from "@/server/api";
import { db } from "@/server/db";
import { deleteLatest, insertLog, loadReviews, REVIEWS } from "@/server/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The periodic reviews: what is due, what was found last time. Nothing here changes the portfolio. */
export async function GET(request: Request) {
  return handle(async () => {
    await guard(request);
    return ok(await loadReviews(await db()));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    await guard(request, true);
    const data = await body(request);
    const q = await db();
    const item = REVIEWS.items.find((i) => i.id === data.item);
    if (!item) throw new HttpError(400, "بند المراجعة غير معروف.");

    switch (data.op) {
      case "record": {
        const result = RESULTS.includes(data.result as ReviewResult) ? (data.result as ReviewResult) : null;
        if (!result) throw new HttpError(400, "اختار نتيجة المراجعة: تمام، محتاج متابعة، أو مشكلة.");
        const note = String(data.note ?? "").trim();
        if (note.length > 600) throw new OpError("الملاحظة طويلة، خليها 600 حرف بالكتير.");
        if (result !== "ok" && !note) throw new OpError("اكتب ملاحظة قصيرة: إيه اللي لقيته أو إيه اللي مستنيه.");
        let days: number | null = null;
        if (data.next_in_days !== undefined && data.next_in_days !== null && data.next_in_days !== "") {
          days = Number(data.next_in_days);
          if (!Number.isInteger(days) || days < 1 || days > MAX_NEXT_DAYS) throw new OpError(`موعد المراجعة الجاية: من يوم لـ ${MAX_NEXT_DAYS} يوم.`);
        }
        const opId = typeof data.op_id === "string" ? data.op_id : "";
        if (opId.length < 8 || opId.length > 80) throw new HttpError(400, "معرّف العملية ناقص.");
        const day = dayOf(data.date);
        const stored = await insertLog(q, { item: item.id, day, result, note, next_due: nextDue(item, result, day, days), op_id: opId });
        const message = !stored
          ? "المراجعة دي اتسجلت قبل كده."
          : result === "ok"
            ? "اتسجلت المراجعة."
            : result === "watch"
              ? "اتسجلت. هتتذكّر بيها تاني في الميعاد."
              : "اتسجلت كمشكلة مفتوحة. هتفضل ظاهرة لحد ما تسجّل مراجعة بنتيجة تانية.";
        return ok({ ok: true, message });
      }
      case "undo": {
        const removed = await deleteLatest(q, item.id);
        if (!removed) throw new OpError("مفيش مراجعة مسجلة للبند ده.");
        return ok({ ok: true, message: "اتشالت آخر مراجعة للبند." });
      }
      default:
        throw new HttpError(400, "نوع العملية غير معروف.");
    }
  });
}
