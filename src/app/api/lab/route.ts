import { OpError } from "@/lib/ops";
import type { Point } from "@/lib/lab";
import { body, guard, handle, HttpError, ok } from "@/server/api";
import { today } from "@/server/config";
import { db } from "@/server/db";
import { backfillFx, importSeries, loadLab } from "@/server/lab";
import { fetchReference } from "@/server/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The crypto paper books: computed from the stored price series on every read. Nothing here trades. */
export async function GET(request: Request) {
  return handle(async () => {
    await guard(request);
    return ok(await loadLab(await db()));
  });
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  return handle(async () => {
    await guard(request, true);
    const data = await body(request);
    const q = await db();
    switch (data.op) {
      case "sync": {
        const reference = await fetchReference(today());
        const fx = await backfillFx(q);
        const failed = { ...reference.failed, ...fx.failed };
        const parts = [`اتحدّثت ${reference.ok.length} قراءة مرجعية`];
        if (fx.filled.length) parts.push(`واتكمّل سعر الصرف لـ ${fx.filled.length} يوم سابق`);
        const names = Object.keys(failed);
        if (names.length) parts.push(`وتعذر: ${names.slice(0, 4).join("، ")}${names.length > 4 ? "…" : ""}`);
        return ok({ ok: true, message: `${parts.join("، ")}.`, failed });
      }
      case "import": {
        const which = data.series === "btc" || data.series === "fx" ? data.series : null;
        if (!which) throw new HttpError(400, "نوع السلسلة غير معروف.");
        if (!Array.isArray(data.rows) || data.rows.length === 0 || data.rows.length > 1500) throw new OpError("ابعت من صف واحد لـ 1500 صف.");
        const rows: Point[] = [];
        const now = today();
        for (const row of data.rows as unknown[]) {
          const [day, value] = Array.isArray(row) ? row : [];
          const price = Number(value);
          if (typeof day !== "string" || !DAY.test(day) || Number.isNaN(Date.parse(day)) || day > now) throw new OpError(`تاريخ غير صالح: ${String(day)}`);
          if (!Number.isFinite(price) || price <= 0 || price > 1e9) throw new OpError(`قيمة غير صالحة يوم ${day}.`);
          rows.push([day, price]);
        }
        const count = await importSeries(q, which, rows);
        return ok({ ok: true, message: `اتسجل ${count} قراءة ${which === "btc" ? "لإغلاق البيتكوين" : "لسعر الصرف"}.` });
      }
      default:
        throw new HttpError(400, "نوع العملية غير معروف.");
    }
  });
}
