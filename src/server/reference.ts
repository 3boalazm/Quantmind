import "server-only";
import { PriceStore, shiftDays, type PriceRow } from "@/lib/engine";
import { db, readPrices, SHARED_BOOK, upsertPrice } from "./db";

/**
 * Reference levels from free public endpoints (no API keys). They are context
 * only: what a holding is worth is whatever the broker app shows, entered with
 * "mark". Each source fails on its own without stopping the others.
 */
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const HEADERS = { "User-Agent": "quantmind/0.2 (personal portfolio tracker)", Accept: "application/json" };

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function finite(value: unknown, what: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`unexpected ${what}`);
  return n;
}

async function usdEgp(): Promise<number> {
  const data = (await getJson("https://open.er-api.com/v6/latest/USD")) as { rates?: Record<string, unknown> };
  return finite(data.rates?.EGP, "EGP rate");
}

async function xauUsd(): Promise<number> {
  const data = (await getJson("https://api.gold-api.com/price/XAU")) as { price?: unknown };
  return finite(data.price, "gold price");
}

/**
 * Daily BTCUSDT closes, oldest first. 500 days: the crypto paper books look back 180 days from
 * month-ends half a year before they start, and need a 200-day average at each of them.
 * The market-data mirror is tried first: the main host refuses some regions.
 */
async function btcDaily(limit = 500): Promise<Array<[string, number]>> {
  const path = `/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=${limit}`;
  let data: unknown;
  try {
    data = await getJson(`https://data-api.binance.vision${path}`);
  } catch {
    data = await getJson(`https://api.binance.com${path}`);
  }
  if (!Array.isArray(data)) throw new Error("unexpected klines");
  return data.map((k: unknown[]) => [new Date(Number(k[0])).toISOString().slice(0, 10), finite(k[4], "close")]);
}

export interface FetchReport {
  ok: string[];
  failed: Record<string, string>;
}

export async function fetchReference(day: string): Promise<FetchReport> {
  const q = await db();
  const ok: string[] = [];
  const failed: Record<string, string> = {};
  const save = (row: PriceRow) => upsertPrice(q, SHARED_BOOK, row);
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 120);

  let rate: number | null = null;
  try {
    rate = await usdEgp();
    await save({ date: day, instrument: "REF_USDEGP", price: rate, source: "open.er-api.com" });
    ok.push(`REF_USDEGP ${rate.toFixed(4)}`);
  } catch (error) {
    failed.REF_USDEGP = reason(error);
  }
  try {
    const ounce = await xauUsd();
    await save({ date: day, instrument: "REF_XAUUSD", price: ounce, source: "gold-api.com" });
    ok.push(`REF_XAUUSD ${ounce.toFixed(2)}`);
    if (rate) {
      const gram = (ounce / GRAMS_PER_TROY_OUNCE) * rate;
      await save({ date: day, instrument: "REF_GOLD24_EGP", price: gram, source: "derived" });
      ok.push(`REF_GOLD24_EGP ${gram.toFixed(2)}`);
    }
  } catch (error) {
    failed.REF_XAUUSD = reason(error);
  }
  try {
    const known = new Set(new PriceStore(await readPrices(q, SHARED_BOOK)).series("REF_BTCUSD").map(([d]) => d));
    const closes = await btcDaily();
    const utcToday = new Date().toISOString().slice(0, 10);
    // skip the candle that is still open, and re-save yesterday in case it was stored half-finished
    const fresh = closes.filter(([d]) => d < utcToday && (!known.has(d) || d >= shiftDays(utcToday, -2)));
    for (const [d, p] of fresh) await save({ date: d, instrument: "REF_BTCUSD", price: p, source: "binance" });
    ok.push(`REF_BTCUSD +${fresh.length}`);
  } catch (error) {
    failed.REF_BTCUSD = reason(error);
  }
  return { ok, failed };
}
