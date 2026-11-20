import * as ops from "@/lib/ops";
import { body, bookOf, dayOf, guard, handle, HttpError, ok } from "@/server/api";
import { deleteLedger, insertLedger, ledgerHasOp, upsertPrice, withBook } from "@/server/db";
import { loadState } from "@/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    await guard(request, true);
    const data = await body(request);
    const book = bookOf(data.book);
    const day = dayOf(data.date);
    // The form sends one id per logical entry. If the reply was lost and the same entry comes again,
    // it is recognised here instead of being stored twice.
    const opId = data.op_id === undefined || data.op_id === null ? null : data.op_id;
    if (opId !== null && (typeof opId !== "string" || !/^[A-Za-z0-9:_-]{8,80}$/.test(opId))) {
      throw new HttpError(400, "معرّف العملية غير صالح.");
    }
    const message = await withBook(book, async (q) => {
      if (opId && (await ledgerHasOp(q, book, opId))) return "العملية دي اتسجلت قبل كده، ومااتكررتش.";
      const state = await loadState(q, book);
      let result: ops.OpResult;
      switch (data.op) {
        case "deposit":
          result = ops.deposit(state, day, data.amount, data.note);
          break;
        case "withdraw":
          result = ops.withdraw(state, day, data.amount, data.note);
          break;
        case "buy":
          result = ops.buy(state, day, data);
          break;
        case "sell":
          result = ops.sell(state, day, data);
          break;
        case "income":
          result = ops.income(state, day, data.instrument, data.amount, data.note);
          break;
        default:
          throw new HttpError(400, "نوع العملية غير معروف.");
      }
      if (result.ledger) {
        ops.checkAddition(state.ledger, result.ledger);
        await insertLedger(q, book, result.ledger, opId);
      }
      if (result.price) {
        const instrument = result.price.instrument;
        const sameDay = state.priceRows.find((r) => r.book === book && r.instrument === instrument && r.date === day);
        if (ops.tradePriceApplies(sameDay?.source)) {
          await upsertPrice(q, book, result.price);
        } else if (sameDay && Math.abs(result.price.price / sameDay.price - 1) > 0.02) {
          // The day's reading stays the valuation; say so when the trade happened at a visibly different price.
          return `${result.message} التقييم لسه على قراءة اليوم اللي دخّلتها. لو الرصيد في التطبيق اتغيّر بعد العملية، حدّثه من شاشة الأسعار.`;
        }
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
    const id = Number(url.searchParams.get("id"));
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "رقم العملية غير صالح.");
    await withBook(book, async (q) => {
      const state = await loadState(q, book);
      ops.checkRemoval(state.ledger, id);
      await deleteLedger(q, book, id);
    });
    return ok({ ok: true, message: "تم حذف العملية." });
  });
}
