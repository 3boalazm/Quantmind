import { isISODate, summary, valuation } from "@/lib/engine";
import { bookOf, guard, handle, HttpError, ok } from "@/server/api";
import { today } from "@/server/config";
import { db } from "@/server/db";
import { loadState } from "@/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the screens need for one book, in one request. */
export async function GET(request: Request) {
  return handle(async () => {
    await guard(request);
    const url = new URL(request.url);
    const book = bookOf(url.searchParams.get("book") ?? "paper");
    const now = today();
    const asofParam = url.searchParams.get("asof");
    if (asofParam && (!isISODate(asofParam) || asofParam > now)) throw new HttpError(400, "التاريخ غير صالح.");
    const asof = asofParam || now;
    const addParam = url.searchParams.get("add");
    const asked = addParam === null || addParam === "" ? null : Number(addParam);
    if (asked !== null && (!Number.isFinite(asked) || asked < 0 || asked > 1e9)) throw new HttpError(400, "مبلغ الإضافة غير صالح.");

    const state = await loadState(await db(), book);
    const { config, ledger, prices, priceRows } = state;
    // No amount asked for: plan the monthly contribution, unless deposited cash is already waiting to be
    // invested (same threshold as the "idle cash" alert, so leftover pounds from rounding do not count).
    let add = asked ?? 0;
    if (asked === null) {
      const now = valuation(config, ledger, prices, asof);
      add = now.wallet > Math.max(1, 0.01 * now.total) ? 0 : config.monthly_contribution;
    }

    const latest = prices.instruments().map((instrument) => {
      const series = prices.series(instrument, asof);
      const last = series[series.length - 1];
      const previous = series.length > 1 ? series[series.length - 2] : null;
      const row = [...priceRows].reverse().find((r) => r.instrument === instrument && last && r.date === last[0]);
      return last
        ? { instrument, date: last[0], price: last[1], previous: previous ? previous[1] : null, points: series.length, source: row?.source ?? "" }
        : null;
    });

    return ok({
      book,
      today: now,
      asof,
      add,
      summary: summary(config, ledger, prices, asof, add),
      ledger: [...ledger].reverse(),
      prices: latest.filter(Boolean),
      config: {
        name: config.name,
        monthly_contribution: config.monthly_contribution,
        instruments: config.instruments,
        buckets: config.buckets,
        stages: config.stages,
        crypto: config.crypto,
        rules: config.rules,
        macro: config.macro ?? {},
      },
    });
  });
}
