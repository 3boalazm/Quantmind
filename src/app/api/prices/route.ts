import { isISODate } from "@/lib/engine";
import * as ops from "@/lib/ops";
import { body, bookOf, dayOf, guard, handle, HttpError, ok } from "@/server/api";
import { deletePrice, SHARED_BOOK, upsertPrice, withBook } from "@/server/db";
import { loadState } from "@/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    await guard(request, true);
    const data = await body(request);
    const book = bookOf(data.book);
    const day = dayOf(data.date);
    const message = await withBook(book, async (q) => {
      const state = await loadState(q, book);
      let result: ops.OpResult;
      switch (data.op) {
        case "set":
          result = ops.setPrice(state, day, data.instrument, data.price);
          break;
        case "mark":
          result = ops.mark(state, day, data.instrument, data.value);
          break;
        case "accrue":
          result = ops.accrue(state, day, data.instrument, data.rate);
          break;
        default:
          throw new HttpError(400, "نوع التحديث غير معروف.");
      }
      if (result.price) {
        // reference series are shared; everything else belongs to the book it was entered in
        const target = result.price.instrument.startsWith("REF_") ? SHARED_BOOK : book;
        await upsertPrice(q, target, result.price);
      }
      return result.message;
    });
    return ok({ ok: true, message });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    await guard(request, true);
    const url = new URL(request.url);
    const book = bookOf(url.searchParams.get("book"));
    const instrument = (url.searchParams.get("instrument") ?? "").toUpperCase();
    const day = url.searchParams.get("date");
    if (!/^[A-Z0-9_]{1,24}$/.test(instrument) || !isISODate(day)) throw new HttpError(400, "بيانات السعر غير صالحة.");
    const removed = await withBook(book, (q) => deletePrice(q, instrument.startsWith("REF_") ? SHARED_BOOK : book, instrument, day));
    if (!removed) throw new HttpError(404, "السعر غير موجود.");
    return ok({ ok: true, message: "تم حذف قراءة السعر." });
  });
}
