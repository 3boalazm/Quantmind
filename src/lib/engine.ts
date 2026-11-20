/**
 * Portfolio maths. Pure functions over (config, ledger rows, PriceStore); no I/O.
 * A line-for-line port of lab/qm/engine.py — tests/golden.test.ts checks the two
 * agree on the same inputs.
 *
 * Conventions
 * - `amount` on a buy is the total cash that left the wallet (fee included);
 *   on a sell it is the net cash that came back.
 * - The wallet is money deposited but not yet invested. It counts in the total
 *   but belongs to no bucket: `plan` is what assigns it.
 * - Performance is measured with a unitised NAV, so monthly deposits do not show
 *   up as "returns" and drawdown stays meaningful while the portfolio grows.
 * - Dates are ISO `YYYY-MM-DD` strings, which compare correctly as strings.
 */

export const EPS = 1e-9;

export type ISODate = string;
export type LedgerType = "deposit" | "withdraw" | "buy" | "sell" | "income" | "fee";
export const LEDGER_TYPES: readonly LedgerType[] = ["deposit", "withdraw", "buy", "sell", "income", "fee"];

export interface LedgerRow {
  id?: number;
  date: ISODate;
  type: LedgerType;
  instrument: string;
  units: number;
  price: number;
  amount: number;
  fee: number;
  note: string;
}

export interface PriceRow {
  date: ISODate;
  instrument: string;
  price: number;
  source?: string;
}

export interface TrendRule {
  series: string;
  sma_days: number;
  confirm_days: number;
}

export interface Instrument {
  name: string;
  bucket: string;
  unit?: string;
  fixed_price?: boolean;
  trend_rule?: TrendRule;
}

export interface Bucket {
  label: string;
  instrument: string;
  risk: boolean;
  min_order?: number;
}

export interface Stage {
  name: string;
  label: string;
  min_value: number;
  targets: Record<string, number>;
  notes?: string[];
}

export interface Config {
  name: string;
  currency: string;
  monthly_contribution: number;
  instruments: Record<string, Instrument>;
  buckets: Record<string, Bucket>;
  stages: Stage[];
  crypto?: { enabled: boolean; from_value: number; target_pct: number };
  rules: {
    warn_drawdown: number;
    stop_drawdown: number;
    stale_days: number;
    min_cash_yield: number;
    review_min_days: number;
    review_benchmark_ratio: number;
  };
  macro?: { cbe_deposit_rate?: number; inflation_urban?: number; as_of?: string };
}

/* ---------- dates ---------- */
const DAY_MS = 86_400_000;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** Whole days from `b` to `a` (a - b). */
export function dayDiff(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

export function shiftDays(d: ISODate, days: number): ISODate {
  return new Date(Date.parse(`${d}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/* ---------- prices ---------- */
/** Price history per instrument. A later row for the same day replaces the earlier one. */
export class PriceStore {
  private readonly dates = new Map<string, ISODate[]>();
  private readonly values = new Map<string, number[]>();

  constructor(rows: Iterable<PriceRow> = []) {
    const byInst = new Map<string, Map<ISODate, number>>();
    for (const r of rows) {
      let m = byInst.get(r.instrument);
      if (!m) byInst.set(r.instrument, (m = new Map()));
      m.set(r.date, Number(r.price));
    }
    for (const [inst, m] of byInst) {
      const days = [...m.keys()].sort();
      this.dates.set(inst, days);
      this.values.set(inst, days.map((d) => m.get(d) as number));
    }
  }

  /** Latest price on or before `asof` as [price, date], or [null, null]. */
  get(instrument: string, asof: ISODate): [number, ISODate] | [null, null] {
    const days = this.dates.get(instrument);
    if (!days || days.length === 0) return [null, null];
    let lo = 0;
    let hi = days.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (days[mid] <= asof) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return [null, null];
    return [(this.values.get(instrument) as number[])[lo - 1], days[lo - 1]];
  }

  series(instrument: string, asof?: ISODate): Array<[ISODate, number]> {
    const days = this.dates.get(instrument) ?? [];
    const values = this.values.get(instrument) ?? [];
    const out: Array<[ISODate, number]> = [];
    for (let i = 0; i < days.length; i++) {
      if (asof === undefined || days[i] <= asof) out.push([days[i], values[i]]);
    }
    return out;
  }

  allDates(instruments?: Set<string>): Set<ISODate> {
    const out = new Set<ISODate>();
    for (const [inst, days] of this.dates) {
      if (!instruments || instruments.has(inst)) for (const d of days) out.add(d);
    }
    return out;
  }

  instruments(): string[] {
    return [...this.dates.keys()].sort();
  }
}

/* ---------- positions and valuation ---------- */
export interface Positions {
  units: Record<string, number>;
  wallet: number;
  contributions: number;
  flows: Record<ISODate, number>;
  last_trade: Record<string, number>;
  first_date: ISODate | null;
}

export function positions(ledger: LedgerRow[], asof?: ISODate): Positions {
  const units: Record<string, number> = {};
  const lastTrade: Record<string, number> = {};
  const flows: Record<ISODate, number> = {};
  let wallet = 0;
  let contributions = 0;
  let firstDate: ISODate | null = null;
  for (const r of ledger) {
    if (asof !== undefined && r.date > asof) continue;
    if (firstDate === null || r.date < firstDate) firstDate = r.date;
    const inst = r.instrument;
    switch (r.type) {
      case "deposit":
        wallet += r.amount;
        contributions += r.amount;
        flows[r.date] = (flows[r.date] ?? 0) + r.amount;
        break;
      case "withdraw":
        wallet -= r.amount;
        contributions -= r.amount;
        flows[r.date] = (flows[r.date] ?? 0) - r.amount;
        break;
      case "buy":
        units[inst] = (units[inst] ?? 0) + r.units;
        wallet -= r.amount;
        if (r.price > 0) lastTrade[inst] = r.price;
        break;
      case "sell":
        units[inst] = (units[inst] ?? 0) - r.units;
        wallet += r.amount;
        if (r.price > 0) lastTrade[inst] = r.price;
        break;
      case "income":
        wallet += r.amount;
        break;
      case "fee":
        wallet -= r.amount;
        break;
    }
  }
  const held: Record<string, number> = {};
  for (const [k, v] of Object.entries(units)) if (Math.abs(v) > EPS) held[k] = v;
  return { units: held, wallet, contributions, flows, last_trade: lastTrade, first_date: firstDate };
}

function priceOf(inst: string, pos: Positions, prices: PriceStore, asof: ISODate): [number, ISODate | null] {
  const [p, d] = prices.get(inst, asof);
  if (p !== null) return [p, d];
  const last = pos.last_trade[inst];
  if (last === undefined) throw new Error(`no price for ${inst} on or before ${asof}`);
  return [last, null];
}

export interface Holding {
  instrument: string;
  name: string;
  bucket: string;
  unit: string;
  units: number;
  price: number;
  price_date: ISODate | null;
  stale: boolean;
  value: number;
}

export interface Valuation {
  asof: ISODate;
  holdings: Holding[];
  buckets: Record<string, number>;
  invested: number;
  wallet: number;
  total: number;
  contributions: number;
  positions: Positions;
}

export function valuation(config: Config, ledger: LedgerRow[], prices: PriceStore, asof: ISODate): Valuation {
  const pos = positions(ledger, asof);
  const staleDays = config.rules.stale_days;
  const holdings: Holding[] = [];
  const buckets: Record<string, number> = {};
  let invested = 0;
  for (const inst of Object.keys(pos.units).sort()) {
    const meta = config.instruments[inst];
    if (!meta) throw new Error(`instrument '${inst}' is in the ledger but not in config`);
    const u = pos.units[inst];
    const [p, d] = priceOf(inst, pos, prices, asof);
    const value = u * p;
    invested += value;
    buckets[meta.bucket] = (buckets[meta.bucket] ?? 0) + value;
    holdings.push({
      instrument: inst,
      name: meta.name,
      bucket: meta.bucket,
      unit: meta.unit ?? "",
      units: u,
      price: p,
      price_date: d,
      stale: !meta.fixed_price && (d === null || dayDiff(asof, d) > staleDays),
      value,
    });
  }
  return {
    asof,
    holdings,
    buckets,
    invested,
    wallet: pos.wallet,
    total: invested + pos.wallet,
    contributions: pos.contributions,
    positions: pos,
  };
}

/* ---------- targets ---------- */
/** Stage and bucket targets (percent, summing to 100) for a portfolio of size `total`. */
export function targetsFor(config: Config, total: number): { stage: Stage; targets: Record<string, number> } {
  const stages = [...config.stages].sort((a, b) => a.min_value - b.min_value);
  let stage = stages[0];
  for (const s of stages) if (total + EPS >= s.min_value) stage = s;
  let targets: Record<string, number> = {};
  for (const [k, v] of Object.entries(stage.targets)) targets[k] = Number(v);
  const crypto = config.crypto;
  if (crypto?.enabled && total + EPS >= (crypto.from_value ?? 0)) {
    const pct = Number(crypto.target_pct);
    const scale = (100 - pct) / 100;
    const scaled: Record<string, number> = {};
    for (const [k, v] of Object.entries(targets)) if (k !== "crypto") scaled[k] = v * scale;
    scaled.crypto = pct;
    targets = scaled;
  }
  const sum = Object.values(targets).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 1e-6) throw new Error(`targets of stage ${stage.name} sum to ${sum}, expected 100`);
  return { stage, targets };
}

/* ---------- performance: unitised NAV, drawdown, benchmark ---------- */
export type NavPoint = [date: ISODate, value: number, nav: number];

/** Deposits/withdrawals on a day are treated as start-of-day flows. */
export function navSeries(ledger: LedgerRow[], prices: PriceStore, asof: ISODate): NavPoint[] {
  const rows = ledger.filter((r) => r.date <= asof);
  if (rows.length === 0) return [];
  let start = rows[0].date;
  const held = new Set<string>();
  const days = new Set<ISODate>([asof]);
  for (const r of rows) {
    if (r.date < start) start = r.date;
    if (r.instrument) held.add(r.instrument);
    days.add(r.date);
  }
  for (const d of prices.allDates(held)) if (start <= d && d <= asof) days.add(d);
  const out: NavPoint[] = [];
  let nav = 1;
  let prev: number | null = null;
  for (const d of [...days].sort()) {
    const pos = positions(rows, d);
    let value = pos.wallet;
    for (const [inst, u] of Object.entries(pos.units)) value += u * priceOf(inst, pos, prices, d)[0];
    const flow = pos.flows[d] ?? 0;
    if (prev === null || prev <= EPS) {
      if (flow > EPS) nav *= value / flow; // same-day costs on the very first investment
    } else {
      nav *= (value - flow) / prev;
    }
    prev = value;
    out.push([d, value, nav]);
  }
  return out;
}

export function drawdown(navs: NavPoint[]): { current: number; max: number; peak_nav: number } {
  let peak = 0;
  let current = 0;
  let worst = 0;
  for (const [, , nav] of navs) {
    peak = Math.max(peak, nav);
    current = peak > 0 ? nav / peak - 1 : 0;
    worst = Math.min(worst, current);
  }
  return { current, max: worst, peak_nav: peak };
}

/** What the same deposits would be worth if all of them had gone to the cash instrument. */
export function benchmark(config: Config, pos: Positions, prices: PriceStore, asof: ISODate): { value: number; meaningful: boolean } {
  const inst = config.buckets.cash.instrument;
  const series = prices.series(inst, asof);
  if (series.length === 0) return { value: pos.contributions, meaningful: false };
  const firstPrice = series[0][1];
  let units = 0;
  for (const d of Object.keys(pos.flows).sort()) {
    const [p] = prices.get(inst, d);
    units += pos.flows[d] / (p ? p : firstPrice);
  }
  const last = series[series.length - 1];
  const span = dayDiff(last[0], series[0][0]);
  return { value: units * last[1], meaningful: series.length >= 2 && span >= 25 };
}

/** Annualised growth of a price series over roughly the last `windowDays`. */
export function annualisedYield(series: Array<[ISODate, number]>, windowDays = 120, minSpan = 25): number | null {
  if (series.length < 2) return null;
  const [lastD, lastP] = series[series.length - 1];
  const from = shiftDays(lastD, -windowDays);
  let start = series.find(([d]) => d >= from) ?? series[0];
  if (dayDiff(lastD, start[0]) < minSpan) start = series[0];
  const span = dayDiff(lastD, start[0]);
  if (span < minSpan || start[1] <= 0) return null;
  return Math.pow(lastP / start[1], 365 / span) - 1;
}

/* ---------- rules ---------- */
export type TrendState =
  | { ready: false; have: number; need: number }
  | { ready: true; below: boolean; above: boolean };

/** below=true when the last `confirm_days` closes are all under the moving average. */
export function trendState(rule: TrendRule, prices: PriceStore, asof: ISODate): TrendState {
  const n = Math.trunc(rule.sma_days);
  const c = Math.trunc(rule.confirm_days);
  const closes = prices.series(rule.series, asof).map(([, p]) => p);
  const need = n + c - 1;
  if (closes.length < need) return { ready: false, have: closes.length, need };
  const below: boolean[] = [];
  for (let i = closes.length - c; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += closes[j];
    below.push(closes[i] < sum / n);
  }
  return { ready: true, below: below.every(Boolean), above: !below.some(Boolean) };
}

export interface Order {
  bucket: string;
  label: string;
  instrument: string;
  name: string;
  amount: number;
}

export interface Transfer {
  from: string;
  to: string;
  to_bucket: string;
  to_name: string;
  amount: number;
}

export interface Plan {
  investable: number;
  orders: Order[];
  parked: Record<string, number>;
  transfers: Transfer[];
  stage: Stage;
  stage_changed: boolean;
  targets: Record<string, number>;
  stopped: boolean;
}

/**
 * Split `investable` across buckets to move toward targets without selling anything.
 *
 * Buckets with a `min_order` are bought in whole lots: a monthly share smaller
 * than one lot is parked in cash, and once enough has built up there the plan
 * proposes moving a lot across.
 */
export function plan(config: Config, val: Valuation, investable: number, currentDrawdown = 0): Plan {
  const rules = config.rules;
  const bucketCfg = config.buckets;
  const valueOf = (b: string) => val.buckets[b] ?? 0;
  const totalAfter = val.invested + investable;
  const stageNow = targetsFor(config, val.total).stage;
  const { stage, targets } = targetsFor(config, totalAfter);
  const stopped = currentDrawdown <= -rules.stop_drawdown + EPS;
  const names = Object.keys(targets);

  const targetValue: Record<string, number> = {};
  const deficit: Record<string, number> = {};
  for (const b of names) {
    targetValue[b] = (targets[b] / 100) * totalAfter;
    deficit[b] = Math.max(0, targetValue[b] - valueOf(b));
    if (stopped && bucketCfg[b].risk) deficit[b] = 0;
  }
  const totalDeficit = names.reduce((a, b) => a + deficit[b], 0);

  const alloc: Record<string, number> = {};
  for (const b of names) alloc[b] = 0;
  if (investable > EPS) {
    if (totalDeficit > EPS) {
      for (const b of names) alloc[b] = (investable * deficit[b]) / totalDeficit;
    } else {
      alloc.cash = investable;
    }
  }

  const parked: Record<string, number> = {};
  for (const b of Object.keys(alloc)) {
    const lot = bucketCfg[b].min_order ?? 0;
    if (lot && alloc[b] > 0 && alloc[b] < lot) {
      parked[b] = alloc[b];
      alloc.cash = (alloc.cash ?? 0) + alloc[b];
      alloc[b] = 0;
    }
  }

  // whole pounds; the rounding remainder stays in cash
  const floored: Record<string, number> = {};
  let flooredSum = 0;
  for (const b of Object.keys(alloc)) {
    floored[b] = Math.floor(alloc[b] + 1e-6);
    flooredSum += floored[b];
  }
  floored.cash = (floored.cash ?? 0) + (Math.floor(investable + 1e-6) - flooredSum);

  const transfers: Transfer[] = [];
  let cashExcess = valueOf("cash") + (floored.cash ?? 0) - (targetValue.cash ?? 0);
  for (const b of names) {
    const lot = bucketCfg[b].min_order ?? 0;
    if (!lot || (stopped && bucketCfg[b].risk)) continue;
    const gap = targetValue[b] - valueOf(b) - floored[b];
    const lots = Math.floor(Math.min(gap, cashExcess) / lot + 1e-9);
    if (lots >= 1) {
      const amount = lots * lot;
      transfers.push({
        from: bucketCfg.cash.instrument,
        to: bucketCfg[b].instrument,
        to_bucket: b,
        to_name: config.instruments[bucketCfg[b].instrument].name,
        amount,
      });
      cashExcess -= amount;
    }
  }

  const orders: Order[] = [];
  for (const [b, amount] of Object.entries(floored)) {
    if (amount >= 1) {
      const inst = bucketCfg[b].instrument;
      orders.push({ bucket: b, label: bucketCfg[b].label, instrument: inst, name: config.instruments[inst].name, amount });
    }
  }
  orders.sort((a, b) => b.amount - a.amount);

  const parkedRounded: Record<string, number> = {};
  for (const [b, v] of Object.entries(parked)) parkedRounded[b] = Math.round(v * 100) / 100;
  return {
    investable,
    orders,
    parked: parkedRounded,
    transfers,
    stage,
    stage_changed: stage.name !== stageNow.name,
    targets,
    stopped,
  };
}

/* ---------- everything the screens need ---------- */
export interface Alert {
  level: "action" | "warn" | "info";
  code: string;
  text: string;
}

export interface AllocationRow {
  bucket: string;
  label: string;
  value: number;
  weight: number;
  target: number;
  gap: number;
}

export interface StageInfo {
  name: string;
  label: string;
  notes: string[];
}

export interface Summary {
  asof: ISODate;
  total: number;
  invested: number;
  wallet: number;
  contributions: number;
  pnl: number;
  pnl_pct: number;
  nav: number;
  drawdown: number;
  max_drawdown: number;
  days_running: number;
  benchmark: { value: number; diff: number; meaningful: boolean };
  cash_yield: number | null;
  stage: StageInfo;
  allocation: AllocationRow[];
  holdings: Holding[];
  plan: {
    investable: number;
    orders: Order[];
    parked: Record<string, number>;
    transfers: Transfer[];
    stage: StageInfo;
    stage_changed: boolean;
    stopped: boolean;
  };
  alerts: Alert[];
  review: { verdict: "early" | "increase" | "hold"; text: string };
  macro: NonNullable<Config["macro"]>;
  history: Array<{ date: ISODate; value: number; nav: number }>;
}

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, minimumFractionDigits: 0 });
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const pct0 = (x: number) => `${(x * 100).toFixed(0)}%`;
const money0 = (x: number) => grouped.format(x);

/** Full state for one date. `add` is money you intend to deposit now, not yet in the ledger. */
export function summary(config: Config, ledger: LedgerRow[], prices: PriceStore, asof: ISODate, add = 0): Summary {
  const rules = config.rules;
  const val = valuation(config, ledger, prices, asof);
  const pos = val.positions;
  const navs = navSeries(ledger, prices, asof);
  const dd = drawdown(navs);
  const bm = benchmark(config, pos, prices, asof);
  const cashInst = config.buckets.cash.instrument;
  const cashYield = annualisedYield(prices.series(cashInst, asof));
  const investable = val.wallet + add;
  const pl = plan(config, val, investable, dd.current);
  const { stage, targets } = targetsFor(config, val.total);

  const total = val.total;
  const bucketOrder = Object.keys(config.buckets);
  const names = bucketOrder.filter((b) => b in targets || b in val.buckets);
  for (const b of Object.keys(val.buckets)) if (!names.includes(b)) names.push(b);
  names.sort((a, b) => (targets[b] ?? 0) - (targets[a] ?? 0));
  const allocation: AllocationRow[] = names.map((b) => {
    const v = val.buckets[b] ?? 0;
    const w = total > EPS ? (100 * v) / total : 0;
    return { bucket: b, label: config.buckets[b].label, value: v, weight: w, target: targets[b] ?? 0, gap: w - (targets[b] ?? 0) };
  });

  const daysRunning = pos.first_date ? dayDiff(asof, pos.first_date) : 0;
  const alerts: Alert[] = [];
  const alert = (level: Alert["level"], code: string, text: string) => alerts.push({ level, code, text });

  if (dd.current <= -rules.stop_drawdown + EPS) {
    alert("action", "stop_drawdown", `المحفظة نازلة ${pct1(Math.abs(dd.current))} من أعلى قيمة. الإضافات للأسهم والكريبتو متوقفة والخطة بتوجه للنقد والذهب بس.`);
  } else if (dd.current <= -rules.warn_drawdown + EPS) {
    alert("warn", "warn_drawdown", `المحفظة نازلة ${pct1(Math.abs(dd.current))} من أعلى قيمة. كمّل بنفس المبلغ ومتزودش الإضافة الشهرية دلوقتي.`);
  }
  for (const h of val.holdings) {
    if (h.stale) {
      const when = h.price_date ?? "سعر آخر عملية";
      alert("warn", "stale_price", `سعر ${h.name} قديم (آخر تحديث: ${when}). حدّثه قبل ما تعتمد على الأرقام.`);
    }
  }
  if (cashYield !== null && cashYield < rules.min_cash_yield) {
    alert("warn", "cash_yield", `عائد صندوق النقد السنوي ${pct1(cashYield)}، أقل من الحد ${pct0(rules.min_cash_yield)}. قارن بالشهادات.`);
  }
  if (bm.meaningful && total < rules.review_benchmark_ratio * bm.value) {
    alert("warn", "below_benchmark", `المحفظة أقل من خط الأساس بـ ${money0(bm.value - total)} جنيه (لو كل الفلوس كانت في صندوق النقد).`);
  }
  if (val.wallet > Math.max(1, 0.01 * total)) {
    alert("info", "idle_cash", `فيه ${money0(val.wallet)} جنيه في الرصيد لسه متوزعتش. نفّذ خطة الشراء.`);
  }
  if (pl.stage_changed) {
    alert("info", "stage_change", `بعد الإضافة دي المحفظة هتدخل مرحلة ${pl.stage.label}، والتوزيع المستهدف هيتغير.`);
  }
  const macro = config.macro ?? {};
  if (macro.as_of) {
    const age = dayDiff(asof, macro.as_of);
    if (age > 45) alert("info", "macro_stale", `أرقام الفايدة والتضخم في الإعدادات عمرها ${age} يوم. حدّثها.`);
  }
  for (const [inst, meta] of Object.entries(config.instruments)) {
    const rule = meta.trend_rule;
    if (!rule) continue;
    const held = (pos.units[inst] ?? 0) > EPS;
    const enabled = meta.bucket === "crypto" ? Boolean(config.crypto?.enabled) : true;
    if (!(held || enabled)) continue;
    const st = trendState(rule, prices, asof);
    if (!st.ready) {
      alert("info", "trend_no_data", `قاعدة متوسط ${rule.sma_days} يوم لـ ${meta.name} محتاجة ${st.need} سعر يومي، الموجود ${st.have}.`);
    } else if (st.below && held) {
      alert("action", "trend_exit", `${meta.name} قفل تحت متوسط ${rule.sma_days} يوم ${rule.confirm_days} أيام ورا بعض. القاعدة: خروج.`);
    } else if (st.below) {
      alert("info", "trend_blocked", `${meta.name} تحت متوسط ${rule.sma_days} يوم. الدخول مؤجل حسب القاعدة.`);
    }
  }

  let review: Summary["review"];
  if (daysRunning < rules.review_min_days || !bm.meaningful) {
    review = { verdict: "early", text: `لسه بدري على الحكم: ${daysRunning} يوم من ${rules.review_min_days} مطلوبين.` };
  } else if (total >= rules.review_benchmark_ratio * bm.value && dd.current > -rules.warn_drawdown) {
    review = { verdict: "increase", text: "المحفظة ماشية مع خط الأساس أو أحسن، والهبوط تحت الحد. كمّل وزوّد لو تحب." };
  } else {
    review = { verdict: "hold", text: "كمّل بنفس المبلغ من غير زيادة لحد المراجعة الجاية." };
  }

  const stageInfo = (s: Stage): StageInfo => ({ name: s.name, label: s.label, notes: s.notes ?? [] });
  return {
    asof,
    total,
    invested: val.invested,
    wallet: val.wallet,
    contributions: val.contributions,
    pnl: total - val.contributions,
    pnl_pct: val.contributions > EPS ? total / val.contributions - 1 : 0,
    nav: navs.length ? navs[navs.length - 1][2] : 1,
    drawdown: dd.current,
    max_drawdown: dd.max,
    days_running: daysRunning,
    benchmark: { value: bm.value, diff: total - bm.value, meaningful: bm.meaningful },
    cash_yield: cashYield,
    stage: stageInfo(stage),
    allocation,
    holdings: val.holdings,
    plan: {
      investable: pl.investable,
      orders: pl.orders,
      parked: pl.parked,
      transfers: pl.transfers,
      stage: stageInfo(pl.stage),
      stage_changed: pl.stage_changed,
      stopped: pl.stopped,
    },
    alerts,
    review,
    macro,
    history: navs.map(([date, value, nav]) => ({ date, value, nav })),
  };
}
