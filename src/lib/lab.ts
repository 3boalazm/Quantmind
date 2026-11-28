/**
 * Paper books for the crypto sleeve.
 *
 * Five ways of buying Bitcoin with the same imaginary monthly deposit, run side by side so the
 * rules can be judged before any real money follows them. Nothing here places an order.
 *
 * The rules were written down on 28 November 2026, before any of the prices they act on
 * existed (investment-plan.md, section 14.5). Changing a rule means a new `version`, not an edit.
 *
 * Every figure is recomputed from the daily price series each time, so a book can be read
 * for any date and always tells the same story.
 */
import { addDays } from "./dates";

export type ISODate = string;
export type Point = [ISODate, number];

export interface LabConfig {
  version: string;
  /** Date the rules were registered and the first deposit day. */
  start: ISODate;
  /** Imaginary deposit in EGP, made on `day` of each month. */
  deposit: number;
  day: number;
  /** All-in cost of a buy or a sell, as a share of the order. An assumption until it is measured. */
  cost: number;
  /** Yearly return of the compliant cash fund where waiting money sits. An assumption until real readings exist. */
  cash_yield: number;
  sma_days: number;
  /** The average must be higher than it was this many days earlier. */
  slope_days: number;
  /** B2 sells after this many closes in a row under the average. */
  exit_days: number;
  vol_days: number;
  /** C buys only while yearly realised volatility is at or under this (1 = 100%). */
  vol_max: number;
  /** D: where new deposits go when Bitcoin lags the cash fund. */
  switch: {
    lag_days: number;
    /** Bitcoin trails the fund by at least this much (0.05 = 5 points) over `lag_days`. */
    lag_gap: number;
    back_days: number;
    /** Bitcoin leads the fund by at least this much over `back_days`, with the trend conditions met. */
    back_gap: number;
    /** Month-end checks in a row needed to change direction. */
    confirm: number;
    /** Month-ends before `start` used to find the state the book begins in. */
    warmup_months: number;
  };
}

export type BookId = "A" | "B" | "B2" | "C" | "D";
export const BOOK_IDS: BookId[] = ["A", "B", "B2", "C", "D"];

export type DecisionKind = "buy" | "wait" | "sell" | "to_fund";

export interface Decision {
  date: ISODate;
  book: BookId;
  kind: DecisionKind;
  /** EGP bought, sold, or left waiting. */
  amount: number;
  /** Short machine-readable reason; the screen turns it into words. */
  reason: "schedule" | "trend_ok" | "trend_down" | "no_data" | "vol_ok" | "vol_high" | "exit_rule" | "state_crypto" | "state_fund";
}

export interface BookResult {
  id: BookId;
  /** Value in EGP at the last computed day: Bitcoin plus waiting cash. */
  value: number;
  btc_value: number;
  cash: number;
  units_btc: number;
  paid: number;
  /** Value of one unit of the book; starts at 1 and ignores the size of deposits. */
  nav: number;
  /** Deepest fall of `nav` from an earlier high (0.25 = 25%). */
  max_drawdown: number;
  /** Deepest fall of the Bitcoin price in EGP since the book first bought; null before any purchase. */
  btc_drawdown: number | null;
  /** Money-weighted yearly return; null until enough time has passed to mean anything. */
  xirr: number | null;
  deposits: number;
  /** Deposit days on which nothing was bought. */
  idle_months: number;
  cash_share: number;
  /** Value minus the shadow portfolio. */
  vs_shadow: number;
}

export interface SwitchCheck {
  date: ISODate;
  /** Bitcoin's return minus the fund's over the window in use, or null when prices were missing. */
  gap: number | null;
  window: number;
  state: "crypto" | "fund";
}

export interface Signals {
  date: ISODate;
  close_usd: number;
  fx: number | null;
  sma: number | null;
  /** Close relative to the average (0.05 = 5% above). */
  above: number | null;
  rising: boolean | null;
  vol: number | null;
  trend_ok: boolean | null;
  switch_state: "crypto" | "fund";
}

export interface LabResult {
  version: string;
  start: ISODate;
  /** Last day every book is computed for; null before the first deposit day has closed. */
  asof: ISODate | null;
  /** The same deposits on the same dates, left in the cash fund. */
  shadow: number;
  paid: number;
  books: BookResult[];
  decisions: Decision[];
  checks: SwitchCheck[];
  signals: Signals | null;
  data: { btc_days: number; btc_first: ISODate | null; btc_last: ISODate | null; fx_last: ISODate | null; missing: string[] };
  /** Next deposit day that has not been computed yet. */
  next_deposit: ISODate;
}

/* ------------------------------------------------------------------ series */

class Series {
  private readonly days: ISODate[];
  private readonly values: number[];
  private readonly index = new Map<ISODate, number>();

  constructor(points: Point[]) {
    const sorted = [...points].filter(([, v]) => Number.isFinite(v) && v > 0).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    this.days = [];
    this.values = [];
    for (const [d, v] of sorted) {
      if (this.index.has(d)) {
        this.values[this.index.get(d) as number] = v;
        continue;
      }
      this.index.set(d, this.days.length);
      this.days.push(d);
      this.values.push(v);
    }
  }

  get length(): number {
    return this.days.length;
  }
  get first(): ISODate | null {
    return this.days[0] ?? null;
  }
  get last(): ISODate | null {
    return this.days[this.days.length - 1] ?? null;
  }

  /** The value on exactly `day`. */
  at(day: ISODate): number | null {
    const i = this.index.get(day);
    return i === undefined ? null : this.values[i];
  }

  /** The latest value on or before `day`, no older than `maxGap` days. */
  near(day: ISODate, maxGap: number): number | null {
    let lo = 0;
    let hi = this.days.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.days[mid] <= day) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return null;
    return this.days[lo - 1] >= addDays(day, -maxGap) ? this.values[lo - 1] : null;
  }

  /** The `n` values ending on `day`, one per calendar day, or null when any is missing. */
  window(day: ISODate, n: number): number[] | null {
    const end = this.index.get(day);
    if (end === undefined || end - n + 1 < 0) return null;
    // closes are daily, so n entries must span exactly n days
    if (this.days[end - n + 1] !== addDays(day, -(n - 1))) return null;
    return this.values.slice(end - n + 1, end + 1);
  }
}

/* ----------------------------------------------------------------- measures */

function sma(btc: Series, day: ISODate, n: number): number | null {
  const w = btc.window(day, n);
  return w ? w.reduce((sum, v) => sum + v, 0) / n : null;
}

/** Yearly realised volatility from the last `n` daily log returns ending on `day` (sample deviation, 365-day year). */
export function realisedVol(btc: Series, day: ISODate, n: number): number | null {
  const w = btc.window(day, n + 1);
  if (!w) return null;
  const returns = w.slice(1).map((v, i) => Math.log(v / w[i]));
  const mean = returns.reduce((sum, r) => sum + r, 0) / n;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) * Math.sqrt(365);
}

/** The trend conditions of book B, read from closes up to `day`. Null when the history is too short. */
function trend(btc: Series, day: ISODate, cfg: LabConfig): { ok: boolean; sma: number; rising: boolean; above: number } | null {
  const close = btc.at(day);
  const now = sma(btc, day, cfg.sma_days);
  const before = sma(btc, addDays(day, -cfg.slope_days), cfg.sma_days);
  if (close === null || now === null || before === null) return null;
  const rising = now > before;
  return { ok: close > now && rising, sma: now, rising, above: close / now - 1 };
}

function fundReturn(cfg: LabConfig, days: number): number {
  return Math.pow(1 + cfg.cash_yield, days / 365) - 1;
}

const FX_GAP = 7;

/** Bitcoin's return in EGP over the `days` ending on `day`, or null when a price or a rate is missing. */
function btcReturnEgp(btc: Series, fx: Series, day: ISODate, days: number): number | null {
  const then = addDays(day, -days);
  const a = btc.at(day);
  const b = btc.at(then);
  const fa = fx.near(day, FX_GAP);
  const fb = fx.near(then, FX_GAP);
  if (a === null || b === null || fa === null || fb === null) return null;
  return (a * fa) / (b * fb) - 1;
}

function lastOfMonth(year: number, month: number): ISODate {
  return new Date(Date.UTC(year, month + 1, 0, 12)).toISOString().slice(0, 10);
}

/** Month-ends from `from` (inclusive) to `to` (inclusive), oldest first. */
function monthEnds(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7)) - 1;
  for (let guard = 0; guard < 1200; guard++) {
    const end = lastOfMonth(year, month);
    if (end > to) break;
    if (end >= from) out.push(end);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return out;
}

function depositDays(cfg: LabConfig, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let year = Number(cfg.start.slice(0, 4));
  let month = Number(cfg.start.slice(5, 7)) - 1;
  for (let guard = 0; guard < 1200; guard++) {
    const day = `${year}-${String(month + 1).padStart(2, "0")}-${String(cfg.day).padStart(2, "0")}`;
    if (day > to) break;
    if (day >= cfg.start) out.push(day);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return out;
}

/** The first month-end the switch rule looks at: `warmup_months` month-ends before the start. */
function warmupFrom(cfg: LabConfig): ISODate {
  const year = Number(cfg.start.slice(0, 4));
  const month = Number(cfg.start.slice(5, 7)) - 1 - cfg.switch.warmup_months;
  return new Date(Date.UTC(year, month, 1, 12)).toISOString().slice(0, 10);
}

/**
 * Book D's rule, month-end by month-end. It starts in "crypto"; two lagging checks in a row
 * send new deposits to the fund, and two leading checks in a row (with the trend conditions
 * met) bring them back. A check that cannot be computed changes nothing.
 */
function switchChecks(btc: Series, fx: Series, cfg: LabConfig, to: ISODate): SwitchCheck[] {
  const rule = cfg.switch;
  const out: SwitchCheck[] = [];
  let state: "crypto" | "fund" = "crypto";
  let streak = 0;
  for (const end of monthEnds(warmupFrom(cfg), to)) {
    if (state === "crypto") {
      const r = btcReturnEgp(btc, fx, end, rule.lag_days);
      const gap = r === null ? null : r - fundReturn(cfg, rule.lag_days);
      if (gap !== null) streak = gap <= -rule.lag_gap ? streak + 1 : 0;
      if (streak >= rule.confirm) {
        state = "fund";
        streak = 0;
      }
      out.push({ date: end, gap, window: rule.lag_days, state });
    } else {
      const r = btcReturnEgp(btc, fx, end, rule.back_days);
      const gap = r === null ? null : r - fundReturn(cfg, rule.back_days);
      const t = trend(btc, end, cfg);
      if (gap !== null && t !== null) streak = gap >= rule.back_gap && t.ok ? streak + 1 : 0;
      if (streak >= rule.confirm) {
        state = "crypto";
        streak = 0;
      }
      out.push({ date: end, gap, window: rule.back_days, state });
    }
  }
  return out;
}

function stateOn(checks: SwitchCheck[], day: ISODate): "crypto" | "fund" {
  let state: "crypto" | "fund" = "crypto";
  for (const c of checks) {
    if (c.date >= day) break;
    state = c.state;
  }
  return state;
}

/** Yearly rate at which the dated flows are worth zero today. */
export function xirr(flows: Array<[ISODate, number]>): number | null {
  if (flows.length < 2) return null;
  const t0 = Date.parse(`${flows[0][0]}T00:00:00Z`);
  const years = flows.map(([d]) => (Date.parse(`${d}T00:00:00Z`) - t0) / (365 * 86_400_000));
  // under a month the rate is mostly noise
  if (years[years.length - 1] < 30 / 365) return null;
  const npv = (rate: number) => flows.reduce((sum, [, amount], i) => sum + amount / Math.pow(1 + rate, years[i]), 0);
  let lo = -0.9999;
  let hi = 100;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/* --------------------------------------------------------------------- books */

interface BookState {
  id: BookId;
  cash: number;
  btc: number;
  navUnits: number;
  peak: number;
  maxDrawdown: number;
  firstBuy: ISODate | null;
  pricePeak: number;
  priceDrawdown: number;
  idle: number;
  flows: Array<[ISODate, number]>;
  nav: number;
}

function newBook(id: BookId): BookState {
  return { id, cash: 0, btc: 0, navUnits: 0, peak: 1, maxDrawdown: 0, firstBuy: null, pricePeak: 0, priceDrawdown: 0, idle: 0, flows: [], nav: 1 };
}

/** Every date the books need a USD/EGP rate for; the server fills in any that are missing. */
export function fxNeeds(cfg: LabConfig, asof: ISODate): ISODate[] {
  const out = new Set<ISODate>();
  for (const d of depositDays(cfg, asof)) out.add(d);
  for (const end of monthEnds(warmupFrom(cfg), asof)) {
    out.add(end);
    out.add(addDays(end, -cfg.switch.lag_days));
    out.add(addDays(end, -cfg.switch.back_days));
  }
  out.add(asof);
  return [...out].sort();
}

export function runLab(cfg: LabConfig, btcPoints: Point[], fxPoints: Point[], asof: ISODate): LabResult {
  const btc = new Series(btcPoints);
  const fx = new Series(fxPoints);
  const missing: string[] = [];
  const daily = Math.pow(1 + cfg.cash_yield, 1 / 365);

  // Books are computed up to the last day that has both a close and a usable exchange rate.
  let last: ISODate | null = null;
  if (btc.last !== null && btc.last >= cfg.start) {
    last = btc.last < asof ? btc.last : asof;
    while (last !== null && last >= cfg.start && (btc.at(last) === null || fx.near(last, FX_GAP) === null)) last = addDays(last, -1);
    if (last !== null && last < cfg.start) last = null;
  }

  const checks = switchChecks(btc, fx, cfg, last ?? btc.last ?? cfg.start);
  const books = BOOK_IDS.map(newBook);
  const decisions: Decision[] = [];
  let shadow = 0;
  let paid = 0;

  if (last !== null) {
    const deposits = new Set(depositDays(cfg, last));
    for (let day = cfg.start; day <= last; day = addDays(day, 1)) {
      const close = btc.at(day);
      const rate = fx.near(day, FX_GAP);
      if (close === null || rate === null) {
        // a gap inside the run: carry yesterday's figures forward and say so
        if (!missing.includes(day)) missing.push(day);
        shadow *= daily;
        for (const b of books) b.cash *= daily;
        continue;
      }
      const price = close * rate;
      const signalDay = addDays(day, -1);
      shadow *= daily;

      for (const b of books) {
        b.cash *= daily;

        // B2 leaves after `exit_days` closes in a row under the average, judged on closes already known.
        if (b.id === "B2" && b.btc > 0) {
          let under = true;
          for (let k = 1; k <= cfg.exit_days && under; k++) {
            const d = addDays(day, -k);
            const c = btc.at(d);
            const avg = sma(btc, d, cfg.sma_days);
            under = c !== null && avg !== null && c < avg;
          }
          if (under) {
            const proceeds = b.btc * price * (1 - cfg.cost);
            decisions.push({ date: day, book: b.id, kind: "sell", amount: proceeds, reason: "exit_rule" });
            b.cash += proceeds;
            b.btc = 0;
          }
        }

        if (deposits.has(day)) {
          // the deposit buys units of the book at yesterday's unit value, so its size never shows up as a gain
          const before = b.btc * price + b.cash;
          const unit = b.navUnits > 0 ? before / b.navUnits : 1;
          b.navUnits += cfg.deposit / unit;
          b.cash += cfg.deposit;
          b.flows.push([day, -cfg.deposit]);

          let spend = 0;
          let reason: Decision["reason"] = "schedule";
          let kind: DecisionKind = "buy";
          if (b.id === "A") {
            spend = cfg.deposit;
          } else if (b.id === "D") {
            if (stateOn(checks, day) === "crypto") {
              spend = cfg.deposit;
              reason = "state_crypto";
            } else {
              kind = "to_fund";
              reason = "state_fund";
            }
          } else {
            const t = trend(btc, signalDay, cfg);
            if (t === null) {
              kind = "wait";
              reason = "no_data";
            } else if (!t.ok) {
              kind = "wait";
              reason = "trend_down";
            } else if (b.id === "C") {
              const vol = realisedVol(btc, signalDay, cfg.vol_days);
              if (vol === null) {
                kind = "wait";
                reason = "no_data";
              } else if (vol > cfg.vol_max) {
                kind = "wait";
                reason = "vol_high";
              } else {
                spend = b.cash;
                reason = "vol_ok";
              }
            } else {
              spend = b.cash;
              reason = "trend_ok";
            }
          }

          if (kind === "buy" && spend > 0) {
            b.btc += (spend * (1 - cfg.cost)) / price;
            b.cash -= spend;
            if (b.firstBuy === null) {
              b.firstBuy = day;
              b.pricePeak = price;
            }
            decisions.push({ date: day, book: b.id, kind, amount: spend, reason });
          } else {
            b.idle += 1;
            decisions.push({ date: day, book: b.id, kind, amount: kind === "to_fund" ? cfg.deposit : b.cash, reason });
          }
        }

        const value = b.btc * price + b.cash;
        if (b.navUnits > 0) {
          b.nav = value / b.navUnits;
          if (b.nav > b.peak) b.peak = b.nav;
          b.maxDrawdown = Math.max(b.maxDrawdown, 1 - b.nav / b.peak);
        }
        if (b.firstBuy !== null) {
          if (price > b.pricePeak) b.pricePeak = price;
          b.priceDrawdown = Math.max(b.priceDrawdown, 1 - price / b.pricePeak);
        }
      }
      if (deposits.has(day)) {
        shadow += cfg.deposit;
        paid += cfg.deposit;
      }
    }
  }

  const lastPrice = last === null ? null : (btc.at(last) as number) * (fx.near(last, FX_GAP) as number);
  const results: BookResult[] = books.map((b) => {
    const btcValue = lastPrice === null ? 0 : b.btc * lastPrice;
    const value = btcValue + b.cash;
    const flows: Array<[ISODate, number]> = last === null ? [] : [...b.flows, [last, value]];
    return {
      id: b.id,
      value,
      btc_value: btcValue,
      cash: b.cash,
      units_btc: b.btc,
      paid,
      nav: b.nav,
      max_drawdown: b.maxDrawdown,
      btc_drawdown: b.firstBuy === null ? null : b.priceDrawdown,
      xirr: xirr(flows),
      deposits: b.flows.length,
      idle_months: b.idle,
      cash_share: value > 0 ? b.cash / value : 0,
      vs_shadow: value - shadow,
    };
  });

  // What the rules would say if tomorrow were a deposit day, from the latest close.
  let signals: Signals | null = null;
  if (btc.last !== null) {
    const day = btc.last;
    const t = trend(btc, day, cfg);
    signals = {
      date: day,
      close_usd: btc.at(day) as number,
      fx: fx.near(day, FX_GAP),
      sma: t?.sma ?? sma(btc, day, cfg.sma_days),
      above: t?.above ?? null,
      rising: t?.rising ?? null,
      vol: realisedVol(btc, day, cfg.vol_days),
      trend_ok: t?.ok ?? null,
      switch_state: stateOn(checks, addDays(day, 1)),
    };
  }

  const next = depositDays(cfg, addDays(last ?? addDays(cfg.start, -1), 62)).find((d) => last === null || d > last) ?? cfg.start;
  return {
    version: cfg.version,
    start: cfg.start,
    asof: last,
    shadow,
    paid,
    books: results,
    decisions: decisions.reverse(),
    checks,
    signals,
    data: { btc_days: btc.length, btc_first: btc.first, btc_last: btc.last, fx_last: fx.last, missing },
    next_deposit: next,
  };
}
