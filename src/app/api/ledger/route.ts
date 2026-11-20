import * as ops from "@/lib/ops";
import { body, bookOf, dayOf, guard, handle, HttpError, ok } from "@/server/api";
import { deleteLedger, insertLedger, upsertPrice, withBook } from "@/server/db";
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
        await insertLedger(q, book, result.ledger);
      }
      // a trade also records its price, unless a later reading for that day already exists
      if (result.price && state.prices.get(result.price.instrument, day)[1] !== day) await upsertPrice(q, book, result.price);
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
