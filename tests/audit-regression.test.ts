/**
 * Cases raised by the external audit of November 2026, kept so they cannot come back.
 */
import { describe, expect, it } from "vitest";
import config from "../config/portfolio.json";
import { PriceStore, summary, type Config, type LedgerRow, type PriceRow } from "../src/lib/engine";
import * as ops from "../src/lib/ops";

const base = config as unknown as Config;
const DAY = "2026-11-20";
const row = (date: string, type: LedgerRow["type"], instrument = "", units = 0, price = 0, amount = 0): LedgerRow => ({
  date,
  type,
  instrument,
  units,
  price,
  amount,
  fee: 0,
  note: "",
});
const shift = (days: number) => new Date(Date.parse(`${DAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function btcSeries(up: boolean): PriceRow[] {
  return Array.from({ length: 210 }, (_, i) => ({
    date: shift(i - 209),
    instrument: "REF_BTCUSD",
    price: i < 205 ? 100 : up ? 120 : 80,
  }));
}

describe("audit regressions", () => {
  it("no bitcoin order while the alert says entry is deferred", () => {
    const cfg = structuredClone(base);
    cfg.crypto!.enabled = true;
    const ledger = [row(DAY, "deposit", "", 0, 0, 5000), row(DAY, "buy", "CASH", 5000, 1, 5000)];
    const prices = [{ date: DAY, instrument: "CASH", price: 1 }, ...btcSeries(false)];
    const s = summary(cfg, ledger, new PriceStore(prices), DAY, 2000);
    expect(s.alerts.map((a) => a.code)).toContain("trend_blocked");
    expect(s.plan.orders.some((o) => o.bucket === "crypto")).toBe(false);
    expect(s.plan.transfers.some((t) => t.to_bucket === "crypto")).toBe(false);
    expect(s.plan.blocked).toEqual(["crypto"]);
    const up = summary(cfg, ledger, new PriceStore([{ date: DAY, instrument: "CASH", price: 1 }, ...btcSeries(true)]), DAY, 2000);
    // with the trend up the bucket is open again (here as a whole-lot transfer out of surplus cash)
    expect(up.plan.blocked).toEqual([]);
    expect(up.plan.orders.some((o) => o.bucket === "crypto") || up.plan.transfers.some((t) => t.to_bucket === "crypto")).toBe(true);
  });

  it("under the stop rule no real-estate share is proposed at stage three", () => {
    const d0 = "2026-06-01";
    const ledger = [
      row(d0, "deposit", "", 0, 0, 60000),
      row(d0, "buy", "CASH", 24000, 1, 24000),
      row(d0, "buy", "GOLD", 4000 / 6500, 6500, 4000),
      row(d0, "buy", "INDEX", 8000, 2, 16000),
      row(d0, "buy", "ACTIVE", 8000, 2, 16000),
    ];
    const prices: PriceRow[] = [
      { date: d0, instrument: "CASH", price: 1 },
      { date: d0, instrument: "GOLD", price: 6500 },
      { date: d0, instrument: "INDEX", price: 2 },
      { date: d0, instrument: "ACTIVE", price: 2 },
      { date: "2026-07-31", instrument: "INDEX", price: 0.2 },
      { date: "2026-07-31", instrument: "ACTIVE", price: 0.2 },
    ];
    const s = summary(base, ledger, new PriceStore(prices), "2026-07-31", 12000);
    expect(s.plan.stopped).toBe(true);
    expect(s.stage.name).toBe("3");
    expect(new Set(s.plan.orders.map((o) => o.bucket))).toEqual(new Set(["cash", "gold"]));
    expect(s.plan.transfers).toEqual([]);
    expect(s.plan.orders.reduce((sum, o) => sum + o.amount, 0)).toBe(12000);
  });

  it("a price far from the last reading is refused until confirmed", () => {
    const ledger = [row(DAY, "deposit", "", 0, 0, 1000), row(DAY, "buy", "GOLD", 0.1, 6800, 680)];
    const state: ops.OpState = { config: base, ledger, prices: new PriceStore([{ date: DAY, instrument: "GOLD", price: 6800 }]), book: "paper" };
    expect(() => ops.setPrice(state, shift(1), "GOLD", 680)).toThrow(ops.ConfirmError);
    expect(ops.setPrice(state, shift(1), "GOLD", 680, "manual", true).price?.price).toBe(680);
  });

  it("sell_all given as the text \"false\" is rejected, not read as true", () => {
    const ledger = [row(DAY, "deposit", "", 0, 0, 1000), row(DAY, "buy", "CASH", 1000, 1, 1000)];
    const state: ops.OpState = { config: base, ledger, prices: new PriceStore([{ date: DAY, instrument: "CASH", price: 1 }]), book: "paper" };
    expect(() => ops.sell(state, DAY, { instrument: "CASH", units: 100, price: 1, sell_all: "false" })).toThrow(ops.OpError);
  });

  it("income from an instrument that was never bought is refused", () => {
    const state: ops.OpState = { config: base, ledger: [], prices: new PriceStore(), book: "paper" };
    expect(() => ops.income(state, DAY, "GOLD", 500)).toThrow(ops.OpError);
  });

  it("a same-day reading entered on purpose is kept; a trade only replaces another trade", () => {
    expect(ops.tradePriceApplies(undefined)).toBe(true);
    expect(ops.tradePriceApplies("trade")).toBe(true);
    expect(ops.tradePriceApplies("manual")).toBe(false);
    expect(ops.tradePriceApplies("mark:real")).toBe(false);
  });

  it("the valuation follows the reading while profit follows the cash paid", () => {
    // audit example: a 900 reading and a purchase at 1,000 on the same first day
    const ledger = [row(DAY, "deposit", "", 0, 0, 1000), row(DAY, "buy", "GOLD", 1, 1000, 1000)];
    const s = summary(base, ledger, new PriceStore([{ date: DAY, instrument: "GOLD", price: 900 }]), DAY);
    expect(s.total).toBe(900);
    expect(s.pnl).toBe(-100);
    expect(s.contributions).toBe(1000);
  });
});
