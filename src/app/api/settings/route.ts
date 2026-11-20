import { isISODate } from "@/lib/engine";
import { body, guard, handle, HttpError, ok } from "@/server/api";
import { buildConfig, OVERRIDES_KEY, today, type Overrides } from "@/server/config";
import { db, readSetting, writeSetting } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function numberIn(value: unknown, min: number, max: number, name: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (value === "" || value === null || !Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name}: قيمة غير صالحة.`);
  return n;
}

export async function PUT(request: Request) {
  return handle(async () => {
    await guard(request, true);
    const data = await body(request);
    const q = await db();
    const next: Overrides = { ...((await readSetting<Overrides>(q, OVERRIDES_KEY)) ?? {}) };
    if ("monthly_contribution" in data) next.monthly_contribution = numberIn(data.monthly_contribution, 0, 1e7, "الإضافة الشهرية");
    if ("crypto_enabled" in data) {
      if (typeof data.crypto_enabled !== "boolean") throw new HttpError(400, "قيمة غير صالحة.");
      next.crypto_enabled = data.crypto_enabled;
    }
    if ("cbe_deposit_rate" in data || "inflation_urban" in data) {
      const asOf = data.macro_as_of === undefined ? today() : data.macro_as_of;
      if (!isISODate(asOf) || asOf > today()) throw new HttpError(400, "تاريخ الأرقام غير صالح.");
      next.macro = {
        ...next.macro,
        ...("cbe_deposit_rate" in data ? { cbe_deposit_rate: numberIn(data.cbe_deposit_rate, 0, 1, "سعر الفايدة") } : {}),
        ...("inflation_urban" in data ? { inflation_urban: numberIn(data.inflation_urban, -0.5, 5, "التضخم") } : {}),
        as_of: asOf,
      };
    }
    buildConfig(next); // must still produce a valid config
    await writeSetting(q, OVERRIDES_KEY, next);
    return ok({ ok: true, message: "تم حفظ الإعدادات." });
  });
}
