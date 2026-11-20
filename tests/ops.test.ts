import { describe, expect, it } from "vitest";
import config from "../config/portfolio.json";
import { PriceStore, positions, type Config, type LedgerRow } from "../src/lib/engine";
import * as ops from "../src/lib/ops";
import { createSession, passwordMatches, verifySession } from "../src/lib/session";

const cfg = config as unknown as Config;
const DAY = "2026-11-20";

function state(ledger: LedgerRow[] = [], prices: Array<{ date: string; instrument: string; price: number }> = []): ops.OpState {
  return { config: cfg, ledger, prices: new PriceStore(prices), book: "paper" };
}

function apply(ledger: LedgerRow[], result: ops.OpResult): LedgerRow[] {
  return result.ledger ? [...ledger, { ...result.ledger, id: ledger.length + 1 }] : ledger;
}

describe("write operations", () => {
  it("deposit then buy keeps the wallet exact", () => {
    let ledger = apply([], ops.deposit(state(), DAY, 2000));
    const buy = ops.buy(state(ledger), DAY, { instrument: "gold", amount: "400", price: 6765, fee_pct: 1 });
    expect(buy.ledger?.fee).toBeCloseTo(4);
    expect(buy.ledger?.units).toBeCloseTo(396 / 6765, 12);
    expect(buy.price).toEqual({ date: DAY, instrument: "GOLD", price: 6765, source: "trade" });
    ledger = apply(ledger, buy);
    expect(positions(ledger).wallet).toBeCloseTo(1600);
  });

  it("a cash fund can be bought with no price on record (1 unit per pound)", () => {
    const ledger = apply([], ops.deposit(state(), DAY, 1200));
    const buy = ops.buy(state(ledger), DAY, { instrument: "CASH", amount: 1200 });
    expect(buy.ledger?.units).toBe(1200);
    expect(buy.ledger?.price).toBe(1);
  });

  it("other instruments need a price or the units received", () => {
    const ledger = apply([], ops.deposit(state(), DAY, 1000));
    expect(() => ops.buy(state(ledger), DAY, { instrument: "INDEX", amount: 400 })).toThrow(ops.OpError);
    const byUnits = ops.buy(state(ledger), DAY, { instrument: "INDEX", amount: 400, units: 200 });
    expect(byUnits.ledger?.price).toBe(2);
  });

  it("refuses to spend more than the wallet, unknown instruments and bad numbers", () => {
    const ledger = apply([], ops.deposit(state(), DAY, 100));
    expect(() => ops.buy(state(ledger), DAY, { instrument: "CASH", amount: 100.01 })).toThrow(ops.OpError);
    expect(() => ops.buy(state(ledger), DAY, { instrument: "DOGE", amount: 10 })).toThrow(ops.OpError);
    expect(() => ops.buy(state(ledger), DAY, { instrument: "__proto__", amount: 10 })).toThrow(ops.OpError);
    for (const bad of [0, -5, "abc", "", null, undefined, Infinity, NaN, 1e13]) {
      expect(() => ops.deposit(state(), DAY, bad)).toThrow(ops.OpError);
    }
    expect(() => ops.withdraw(state(ledger), DAY, 500)).toThrow(ops.OpError);
  });

  it("sell: partial, all, and never more than held", () => {
    let ledger = apply([], ops.deposit(state(), DAY, 1000));
    ledger = apply(ledger, ops.buy(state(ledger), DAY, { instrument: "CASH", amount: 1000 }));
    const prices = [{ date: DAY, instrument: "CASH", price: 1.1 }];
    expect(() => ops.sell(state(ledger, prices), DAY, { instrument: "CASH", units: 1000.5 })).toThrow(ops.OpError);
    expect(() => ops.sell(state(ledger, prices), DAY, { instrument: "CASH" })).toThrow(ops.OpError);
    const all = ops.sell(state(ledger, prices), DAY, { instrument: "CASH", sell_all: true, fee_pct: 1 });
    expect(all.ledger?.units).toBe(1000);
    expect(all.ledger?.amount).toBeCloseTo(1100 * 0.99);
  });

  it("mark turns an app balance into a unit price", () => {
    let ledger = apply([], ops.deposit(state(), DAY, 1200));
    ledger = apply(ledger, ops.buy(state(ledger), DAY, { instrument: "CASH", amount: 1200 }));
    const result = ops.mark(state(ledger), "2026-12-20", "CASH", 1218);
    expect(result.price?.price).toBeCloseTo(1.015, 12);
    expect(result.price?.source).toBe("mark:paper");
    expect(() => ops.mark(state(ledger), DAY, "GOLD", 500)).toThrow(ops.OpError);
  });

  it("accrue compounds from the last reading", () => {
    const prices = [{ date: "2026-11-20", instrument: "CASH", price: 1 }];
    const result = ops.accrue(state([], prices), "2027-11-20", "CASH", 0.18);
    expect(result.price?.price).toBeCloseTo(1.18, 10);
    expect(() => ops.accrue(state([], prices), DAY, "CASH", 18)).toThrow(ops.OpError);
    expect(() => ops.accrue(state(), DAY, "CASH", 0.18)).toThrow(ops.OpError);
  });

  it("deleting a deposit that later buys depend on is refused; deleting the buy first is fine", () => {
    let ledger = apply([], ops.deposit(state(), DAY, 1000));
    ledger = apply(ledger, ops.buy(state(ledger), DAY, { instrument: "CASH", amount: 1000 }));
    expect(() => ops.checkRemoval(ledger, 1)).toThrow(ops.OpError);
    expect(() => ops.checkRemoval(ledger, 2)).not.toThrow();
    expect(() => ops.checkRemoval(ledger, 99)).toThrow(ops.OpError);
  });

  it("a back-dated withdrawal that would overdraw later entries is refused", () => {
    let ledger = apply([], ops.deposit(state(), "2026-11-01", 1000));
    ledger = apply(ledger, ops.buy(state(ledger), "2026-11-10", { instrument: "CASH", amount: 1000 }));
    const early = ops.withdraw(state(ledger), "2026-11-05", 600); // fine on the 5th in isolation
    expect(() => ops.checkAddition(ledger, early.ledger!)).toThrow(ops.OpError);
  });
});

describe("price sanity check", () => {
  const prices = [{ date: "2026-11-01", instrument: "GOLD", price: 6800 }];
  const funded = () => {
    let ledger = apply([], ops.deposit(state(), "2026-11-01", 10000));
    ledger = apply(ledger, ops.buy(state(ledger, prices), "2026-11-01", { instrument: "GOLD", amount: 6800 }));
    return ledger; // exactly 1 gram
  };

  it("holds a price far from the last reading until it is confirmed", () => {
    const ledger = funded();
    // 680 typed instead of 6,800
    expect(() => ops.mark(state(ledger, prices), DAY, "GOLD", 680)).toThrow(ops.ConfirmError);
    expect(() => ops.setPrice(state(ledger, prices), DAY, "GOLD", 68000)).toThrow(ops.ConfirmError);
    expect(() => ops.buy(state(ledger, prices), DAY, { instrument: "GOLD", amount: 400, units: 4 })).toThrow(ops.ConfirmError);
    expect(() => ops.sell(state(ledger, prices), DAY, { instrument: "GOLD", units: 0.5, price: 680 })).toThrow(ops.ConfirmError);
    expect(ops.mark(state(ledger, prices), DAY, "GOLD", 680, true).price?.price).toBe(680);
    expect(ops.setPrice(state(ledger, prices), DAY, "GOLD", 68000, "manual", true).price?.price).toBe(68000);
  });

  it("lets ordinary moves, first readings and reference series through", () => {
    const ledger = funded();
    expect(ops.mark(state(ledger, prices), DAY, "GOLD", 7175).price?.price).toBe(7175);
    expect(ops.setPrice(state(ledger, prices), DAY, "INDEX", 2.07).price?.price).toBe(2.07);
    const ref = [{ date: "2026-11-01", instrument: "REF_BTCUSD", price: 65000 }];
    expect(ops.setPrice(state([], ref), DAY, "REF_BTCUSD", 20000).price?.price).toBe(20000);
  });

  it("a ConfirmError is still an OpError, so nothing is stored unless the caller opts in", () => {
    expect(new ops.ConfirmError("x")).toBeInstanceOf(ops.OpError);
  });
});

describe("session cookie", () => {
  it("round-trips, expires, and rejects tampering", async () => {
    process.env.APP_PASSWORD = "unit-test-only";
    const now = Date.parse("2026-11-20T00:00:00Z");
    const token = (await createSession(now))!;
    expect(await verifySession(token, now)).toBe(true);
    expect(await verifySession(token, now + 31 * 86_400_000)).toBe(false);
    const [expiry, mac] = token.split(".");
    expect(await verifySession(`${Number(expiry) + 1}.${mac}`, now)).toBe(false);
    expect(await verifySession(`${expiry}.${mac.slice(0, -1)}0`, now)).toBe(mac.endsWith("0"));
    expect(await verifySession("", now)).toBe(false);
    expect(await verifySession("garbage", now)).toBe(false);
    expect(await passwordMatches("unit-test-only")).toBe(true);
    expect(await passwordMatches("unit-test-onlx")).toBe(false);
    process.env.APP_PASSWORD = "changed";
    expect(await verifySession(token, now)).toBe(false); // changing the password signs everyone out
    delete process.env.APP_PASSWORD;
    expect(await createSession(now)).toBeNull();
    expect(await verifySession(token, now)).toBe(false);
  });
});
