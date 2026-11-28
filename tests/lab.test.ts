import { describe, expect, it } from "vitest";
import base from "../config/crypto-lab.json";
import { addDays } from "../src/lib/dates";
import { fxNeeds, runLab, xirr, type LabConfig, type Point } from "../src/lib/lab";

const cfg = base as LabConfig;

/** Daily closes from `from` to `to`; `price(i, day)` gives the close of the i-th day. */
function closes(from: string, to: string, price: (i: number, day: string) => number): Point[] {
  const out: Point[] = [];
  let i = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) out.push([d, price(i++, d)]);
  return out;
}

const flatFx = (from: string, to: string, rate = 50): Point[] => closes(from, to, () => rate);
const HISTORY = "2025-06-01";
const book = (result: ReturnType<typeof runLab>, id: string) => result.books.find((b) => b.id === id)!;

describe("before the first deposit day has closed", () => {
  it("shows the signals and waits", () => {
    const btc = closes(HISTORY, "2026-11-27", (i) => 50_000 + i * 20);
    const result = runLab(cfg, btc, flatFx(HISTORY, "2026-11-27"), "2026-11-28");
    expect(result.asof).toBeNull();
    expect(result.paid).toBe(0);
    expect(result.books.every((b) => b.value === 0 && b.deposits === 0)).toBe(true);
    expect(result.next_deposit).toBe("2026-11-28");
    expect(result.signals).toMatchObject({ date: "2026-11-27", trend_ok: true, rising: true });
    expect(result.decisions).toEqual([]);
  });
});

describe("a steadily rising market", () => {
  const to = "2027-03-10";
  const btc = closes(HISTORY, to, (i) => 40_000 * Math.pow(1.002, i));
  const result = runLab(cfg, btc, flatFx(HISTORY, to), to);

  it("has every book buying each month, so A, B, B2, C and D hold the same", () => {
    expect(result.asof).toBe(to);
    expect(result.paid).toBe(4000);
    const a = book(result, "A");
    expect(a.deposits).toBe(4);
    expect(a.idle_months).toBe(0);
    for (const id of ["B", "B2", "C", "D"]) {
      expect(book(result, id).value).toBeCloseTo(a.value, 6);
      expect(book(result, id).idle_months).toBe(0);
    }
    expect(a.cash).toBeCloseTo(0, 9);
    expect(a.vs_shadow).toBeGreaterThan(0);
  });

  it("charges the assumed cost on each buy", () => {
    const firstClose = btc.find(([d]) => d === "2026-11-28")![1];
    const lastClose = btc[btc.length - 1][1];
    // one deposit only: 1,000 less 1%, at the close of the 28th
    const one = runLab(cfg, btc.filter(([d]) => d <= "2026-12-20"), flatFx(HISTORY, "2026-12-20"), "2026-12-20");
    const closeThen = btc.find(([d]) => d === "2026-12-20")![1];
    expect(book(one, "A").value).toBeCloseTo((990 / (firstClose * 50)) * closeThen * 50, 6);
    expect(lastClose).toBeGreaterThan(firstClose);
  });

  it("keeps the unit value free of the deposits themselves", () => {
    const a = book(result, "A");
    // four deposits, yet the unit value only reflects price moves and the 1% cost
    expect(a.nav).toBeGreaterThan(1);
    expect(a.nav).toBeLessThan(1.3);
    expect(a.max_drawdown).toBeGreaterThan(0.009); // the cost on the first buy is a 1% fall of the unit
    expect(a.max_drawdown).toBeLessThan(0.03);
  });
});

describe("a falling market", () => {
  const to = "2027-03-10";
  const btc = closes(HISTORY, to, (i) => 100_000 * Math.pow(0.998, i));
  const result = runLab(cfg, btc, flatFx(HISTORY, to), to);

  it("has B, B2 and C waiting in the cash fund while A keeps buying", () => {
    const a = book(result, "A");
    expect(a.vs_shadow).toBeLessThan(0);
    for (const id of ["B", "B2", "C"]) {
      const b = book(result, id);
      expect(b.idle_months).toBe(4);
      expect(b.units_btc).toBe(0);
      // waiting money earns exactly what the shadow portfolio earns
      expect(b.value).toBeCloseTo(result.shadow, 6);
      expect(b.cash_share).toBe(1);
      expect(b.btc_drawdown).toBeNull();
      expect(b.max_drawdown).toBe(0);
    }
    expect(result.decisions.filter((d) => d.book === "B").every((d) => d.kind === "wait" && d.reason === "trend_down")).toBe(true);
  });

  it("sends D's deposits to the fund once the lag is confirmed", () => {
    // falling for months before the start: the warm-up checks already put D in the fund state
    expect(result.checks.slice(0, 6).map((c) => c.state)).toEqual(["crypto", "fund", "fund", "fund", "fund", "fund"]);
    const d = book(result, "D");
    expect(d.units_btc).toBe(0);
    expect(d.value).toBeCloseTo(result.shadow, 6);
    expect(result.decisions.filter((x) => x.book === "D").every((x) => x.kind === "to_fund" && x.reason === "state_fund")).toBe(true);
    expect(result.signals?.switch_state).toBe("fund");
  });

  it("measures the fall of the unit and of the Bitcoin price for A", () => {
    const a = book(result, "A");
    expect(a.max_drawdown).toBeGreaterThan(0.1);
    expect(a.btc_drawdown).toBeCloseTo(1 - Math.pow(0.998, 102), 6); // 28 Nov to 10 Mar
  });
});

describe("book B2", () => {
  it("sells after five closes in a row under the average and waits for the trend to return", () => {
    const to = "2027-02-20";
    // rising until the end of 2026, then a sharp fall
    const peakDay = 578; // 2026-12-31 counted from HISTORY
    const btc = closes(HISTORY, to, (i) => (i <= peakDay ? 40_000 * Math.pow(1.002, i) : 40_000 * Math.pow(1.002, peakDay) * Math.pow(0.97, i - peakDay)));
    const result = runLab(cfg, btc, flatFx(HISTORY, to), to);
    const sells = result.decisions.filter((d) => d.book === "B2" && d.kind === "sell");
    expect(sells).toHaveLength(1);
    expect(sells[0].reason).toBe("exit_rule");
    const b2 = book(result, "B2");
    const b = book(result, "B");
    expect(b2.units_btc).toBe(0);
    expect(b.units_btc).toBeGreaterThan(0);
    // getting out early in a long fall leaves B2 ahead of B, which never sells
    expect(b2.value).toBeGreaterThan(b.value);
    // B bought on 28 Nov and 28 Dec, then the trend broke
    expect(result.decisions.filter((d) => d.book === "B" && d.kind === "buy").map((d) => d.date)).toEqual(["2026-12-28", "2026-11-28"]);
  });
});

describe("book C", () => {
  it("waits while volatility is above the limit even though the trend is up", () => {
    const to = "2026-12-05";
    // an up-trend with violent daily swings: about 8% up one day, 7% down the next
    const btc = closes(HISTORY, to, (i) => 40_000 * Math.pow(1.002, i) * (i % 2 === 0 ? 1.04 : 0.96));
    const result = runLab(cfg, btc, flatFx(HISTORY, to), to);
    expect(result.signals!.vol!).toBeGreaterThan(1);
    const c = result.decisions.find((d) => d.book === "C")!;
    expect(c).toMatchObject({ kind: "wait", reason: "vol_high" });
    expect(result.decisions.find((d) => d.book === "B")).toMatchObject({ kind: "buy", reason: "trend_ok" });
  });
});

describe("book D", () => {
  it("comes back to Bitcoin after two leading month-ends with the trend up", () => {
    const to = "2027-09-10";
    // falls until the end of 2026, then climbs fast
    const turn = 578;
    const btc = closes(HISTORY, to, (i) => (i <= turn ? 100_000 * Math.pow(0.998, i) : 100_000 * Math.pow(0.998, turn) * Math.pow(1.006, i - turn)));
    const result = runLab(cfg, btc, flatFx(HISTORY, to), to);
    const states = result.checks.map((c) => `${c.date.slice(0, 7)}:${c.state}`);
    expect(states[0]).toBe("2026-05:crypto");
    expect(states).toContain("2026-12:fund");
    const back = result.checks.find((c) => c.date > "2026-12-31" && c.state === "crypto");
    expect(back).toBeDefined();
    const kinds = result.decisions.filter((d) => d.book === "D").map((d) => d.kind);
    expect(kinds).toContain("to_fund");
    expect(kinds[0]).toBe("buy"); // newest first: buying again by the end
    // what went to the fund stays there
    expect(book(result, "D").cash).toBeGreaterThan(1000);
  });

  it("leaves the state alone when a check cannot be computed", () => {
    const to = "2026-12-05";
    const btc = closes("2026-09-01", to, () => 60_000); // not enough history for a 180-day return
    const result = runLab(cfg, btc, flatFx("2026-09-01", to), to);
    expect(result.checks.every((c) => c.gap === null && c.state === "crypto")).toBe(true);
    expect(result.decisions.find((d) => d.book === "D")).toMatchObject({ kind: "buy", reason: "state_crypto" });
    // too little history for a 200-day average: B says so instead of guessing
    expect(result.decisions.find((d) => d.book === "B")).toMatchObject({ kind: "wait", reason: "no_data" });
  });
});

describe("no peeking", () => {
  it("decides from the close before the deposit day, whatever that day's own close is", () => {
    const to = "2026-11-28";
    const up = closes(HISTORY, to, (i) => 40_000 + i * 30);
    const crashOnTheDay = up.map(([d, v]) => (d === "2026-11-28" ? ([d, v * 0.5] as Point) : ([d, v] as Point)));
    const a = runLab(cfg, up, flatFx(HISTORY, to), to);
    const b = runLab(cfg, crashOnTheDay, flatFx(HISTORY, to), to);
    expect(a.decisions.find((d) => d.book === "B")!.kind).toBe("buy");
    expect(b.decisions.find((d) => d.book === "B")!.kind).toBe("buy");
    // the fill does use the day's close
    expect(book(b, "B").units_btc).toBeCloseTo(book(a, "B").units_btc * 2, 9);
  });
});

describe("data gaps", () => {
  it("stops at the last day that has both a close and a recent exchange rate", () => {
    const btc = closes(HISTORY, "2026-12-20", (i) => 40_000 + i * 30);
    const fx = flatFx(HISTORY, "2026-12-02");
    const result = runLab(cfg, btc, fx, "2026-12-20");
    expect(result.asof).toBe("2026-12-09"); // the rate of 2 Dec is used for seven days, no longer
    expect(result.data).toMatchObject({ btc_last: "2026-12-20", fx_last: "2026-12-02" });
  });

  it("values in EGP: a weaker pound lifts the book even when the dollar price is flat", () => {
    const to = "2026-12-28";
    const btc = closes(HISTORY, to, () => 60_000);
    const fx = closes(HISTORY, to, (_, d) => (d <= "2026-11-28" ? 50 : 55));
    const result = runLab(cfg, btc, fx, addDays(to, -1));
    expect(book(result, "A").value).toBeCloseTo(990 * 1.1, 6);
  });
});

describe("helpers", () => {
  it("finds the yearly rate of dated flows", () => {
    expect(xirr([["2026-01-01", -1000], ["2027-01-01", 1180]])).toBeCloseTo(0.18, 6);
    expect(xirr([["2026-01-01", -1000], ["2026-01-10", 1010]])).toBeNull();
    expect(xirr([["2026-01-01", -1000]])).toBeNull();
  });

  it("gives money that only waits the fund's own rate", () => {
    const to = "2027-11-27";
    const btc = closes(HISTORY, to, (i) => 100_000 * Math.pow(0.999, i));
    const result = runLab(cfg, btc, flatFx(HISTORY, to), to);
    expect(book(result, "B").xirr).toBeCloseTo(0.18, 3);
  });

  it("lists the dates an exchange rate is needed for", () => {
    const needs = fxNeeds(cfg, "2026-12-31");
    expect(needs).toContain("2026-11-28");
    expect(needs).toContain("2026-12-28");
    expect(needs).toContain("2026-05-31");
    expect(needs).toContain(addDays("2026-05-31", -180));
    expect(needs).toContain(addDays("2026-12-31", -90));
    expect(needs[needs.length - 1]).toBe("2026-12-31");
  });
});
