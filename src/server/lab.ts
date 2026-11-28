import "server-only";
import base from "../../config/crypto-lab.json";
import { addDays } from "@/lib/dates";
import { PriceStore } from "@/lib/engine";
import { fxNeeds, runLab, type LabConfig, type LabResult, type Point } from "@/lib/lab";
import { today } from "./config";
import { readPrices, SHARED_BOOK, upsertPrice, type Queryable } from "./db";

export const LAB_CONFIG = base as LabConfig;
const BTC = "REF_BTCUSD";
const FX = "REF_USDEGP";
const HEADERS = { "User-Agent": "quantmind/0.2 (personal portfolio tracker)", Accept: "application/json" };

export interface LabView extends LabResult {
  config: LabConfig;
  today: string;
}

async function series(q: Queryable): Promise<{ btc: Point[]; fx: Point[] }> {
  const store = new PriceStore(await readPrices(q, SHARED_BOOK));
  return { btc: store.series(BTC), fx: store.series(FX) };
}

export async function loadLab(q: Queryable): Promise<LabView> {
  const { btc, fx } = await series(q);
  const day = today();
  return { ...runLab(LAB_CONFIG, btc, fx, day), config: LAB_CONFIG, today: day };
}

/** The USD/EGP rate published for one past day. Two hosts serve the same dated files. */
async function fxOn(day: string): Promise<number> {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.json`,
    `https://${day}.currency-api.pages.dev/v1/currencies/usd.json`,
  ];
  let last: unknown = new Error("no source");
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { usd?: Record<string, unknown> };
      const rate = Number(data.usd?.egp);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error("unexpected EGP rate");
      return rate;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

export interface BackfillReport {
  filled: string[];
  failed: Record<string, string>;
}

/**
 * The books look back up to 180 days from month-ends that predate the daily pulls, so those
 * few past dates are fetched once. A day is fetched only when nothing is stored within the
 * week before it; at most `limit` per call, so one slow source cannot stall the request.
 */
export async function backfillFx(q: Queryable, limit = 24): Promise<BackfillReport> {
  const { fx } = await series(q);
  const have = fx.map(([d]) => d).sort();
  const covered = (day: string) => {
    const from = addDays(day, -7);
    return have.some((d) => d >= from && d <= day);
  };
  const day = today();
  const wanted = fxNeeds(LAB_CONFIG, day)
    .filter((d) => d < day && !covered(d))
    .slice(-limit);
  const filled: string[] = [];
  const failed: Record<string, string> = {};
  for (let i = 0; i < wanted.length; i += 6) {
    await Promise.all(
      wanted.slice(i, i + 6).map(async (d) => {
        try {
          const rate = await fxOn(d);
          await upsertPrice(q, SHARED_BOOK, { date: d, instrument: FX, price: rate, source: "currency-api" });
          filled.push(d);
        } catch (error) {
          failed[d] = (error instanceof Error ? error.message : String(error)).slice(0, 80);
        }
      }),
    );
  }
  return { filled: filled.sort(), failed };
}

/** Rows typed or pasted in by hand, for the days a source could not supply. */
export async function importSeries(q: Queryable, which: "btc" | "fx", rows: Point[]): Promise<number> {
  const instrument = which === "btc" ? BTC : FX;
  for (const [day, value] of rows) await upsertPrice(q, SHARED_BOOK, { date: day, instrument, price: value, source: "import" });
  return rows.length;
}
