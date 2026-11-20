/**
 * Write operations. Each one validates against the current state and returns
 * the rows to store plus a short message; nothing here touches the database.
 * Port of lab/qm/ops.py, with user-facing messages in Arabic.
 */
import { EPS, positions, type Config, type ISODate, type LedgerRow, type PriceRow, type PriceStore } from "./engine";

export const TOL = 0.005; // half a piastre

export class OpError extends Error {}

export interface OpState {
  config: Config;
  ledger: LedgerRow[];
  prices: PriceStore;
  book: string;
}

export interface OpResult {
  ledger?: Omit<LedgerRow, "id">;
  price?: PriceRow;
  message: string;
}

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 });

function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function positive(value: unknown, name: string): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (Number.isNaN(n)) throw new OpError(`${name}: لازم يكون رقم.`);
  if (!(n > 0) || !Number.isFinite(n)) throw new OpError(`${name}: لازم يكون أكبر من صفر.`);
  if (n > 1e12) throw new OpError(`${name}: الرقم كبير بشكل غير منطقي.`);
  return n;
}

function instrumentOf(state: OpState, inst: unknown): string {
  const code = String(inst ?? "").trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(state.config.instruments, code)) {
    throw new OpError(`أداة غير معروفة: ${code || "—"}.`);
  }
  return code;
}

function feeOf(base: number, fee: unknown, feePct: unknown): number {
  let out: number;
  if (given(fee)) out = Number(fee);
  else out = (base * (given(feePct) ? Number(feePct) : 0)) / 100;
  if (Number.isNaN(out)) throw new OpError("الرسوم: لازم تكون رقم.");
  if (out < 0) throw new OpError("الرسوم مينفعش تكون بالسالب.");
  return out;
}

function note(value: unknown): string {
  return String(value ?? "").slice(0, 300);
}

const blank = { instrument: "", units: 0, price: 0, amount: 0, fee: 0, note: "" };

export function deposit(state: OpState, day: ISODate, amount: unknown, text?: unknown): OpResult {
  const a = positive(amount, "المبلغ");
  return { ledger: { ...blank, date: day, type: "deposit", amount: a, note: note(text) }, message: `تم تسجيل إيداع ${money.format(a)} جنيه.` };
}

export function withdraw(state: OpState, day: ISODate, amount: unknown, text?: unknown): OpResult {
  const a = positive(amount, "المبلغ");
  const wallet = positions(state.ledger, day).wallet;
  if (a > wallet + TOL) throw new OpError(`الرصيد غير الموزع ${money.format(wallet)} جنيه بس. بيع حاجة الأول.`);
  return { ledger: { ...blank, date: day, type: "withdraw", amount: a, note: note(text) }, message: `تم تسجيل سحب ${money.format(a)} جنيه.` };
}

export interface TradeInput {
  instrument?: unknown;
  amount?: unknown;
  units?: unknown;
  price?: unknown;
  fee?: unknown;
  fee_pct?: unknown;
  note?: unknown;
  sell_all?: unknown;
}

export function buy(state: OpState, day: ISODate, input: TradeInput): OpResult {
  const inst = instrumentOf(state, input.instrument);
  const amount = positive(input.amount, "المبلغ");
  const wallet = positions(state.ledger, day).wallet;
  if (amount > wallet + TOL) {
    throw new OpError(`الرصيد غير الموزع ${money.format(wallet)} جنيه والمطلوب ${money.format(amount)}. سجّل الإيداع الأول.`);
  }
  const fee = feeOf(amount, input.fee, input.fee_pct);
  const net = amount - fee;
  if (net <= 0) throw new OpError("الرسوم أكبر من المبلغ.");
  let units: number;
  let price: number;
  if (given(input.units)) {
    units = positive(input.units, "الكمية");
    price = net / units;
  } else {
    if (given(input.price)) {
      price = positive(input.price, "السعر");
    } else {
      const known = state.prices.get(inst, day)[0];
      // a cash-like fund is tracked as "1 unit = 1 pound put in", so it can start at 1
      const fallback = state.config.instruments[inst].bucket === "cash" ? 1 : null;
      const p = known ?? fallback;
      if (!p) throw new OpError(`مفيش سعر معروف لـ ${inst}: اكتب السعر أو الكمية اللي استلمتها.`);
      price = p;
    }
    units = net / price;
  }
  return {
    ledger: { date: day, type: "buy", instrument: inst, units, price, amount, fee, note: note(input.note) },
    price: { date: day, instrument: inst, price, source: "trade" },
    message: `شراء ${inst}: ${qty.format(units)} × ${qty.format(price)} = ${money.format(amount)} جنيه (رسوم ${money.format(fee)}).`,
  };
}

export function sell(state: OpState, day: ISODate, input: TradeInput): OpResult {
  const inst = instrumentOf(state, input.instrument);
  const held = positions(state.ledger, day).units[inst] ?? 0;
  const units = input.sell_all ? held : given(input.units) ? positive(input.units, "الكمية") : 0;
  if (units <= EPS || units > held + EPS) {
    throw new OpError(`المملوك من ${inst} هو ${qty.format(held)}؛ مينفعش تبيع ${qty.format(units)}.`);
  }
  const price = given(input.price) ? positive(input.price, "السعر") : state.prices.get(inst, day)[0];
  if (!price) throw new OpError(`مفيش سعر معروف لـ ${inst}: اكتب السعر.`);
  const gross = units * price;
  const fee = feeOf(gross, input.fee, input.fee_pct);
  if (fee > gross) throw new OpError("الرسوم أكبر من حصيلة البيع.");
  return {
    ledger: { date: day, type: "sell", instrument: inst, units, price, amount: gross - fee, fee, note: note(input.note) },
    price: { date: day, instrument: inst, price, source: "trade" },
    message: `بيع ${inst}: ${qty.format(units)} × ${qty.format(price)} ← ${money.format(gross - fee)} جنيه للرصيد (رسوم ${money.format(fee)}).`,
  };
}

export function income(state: OpState, day: ISODate, instrument: unknown, amount: unknown, text?: unknown): OpResult {
  const inst = instrumentOf(state, instrument);
  const a = positive(amount, "المبلغ");
  return {
    ledger: { ...blank, date: day, type: "income", instrument: inst, amount: a, note: note(text) },
    message: `تم تسجيل عائد ${money.format(a)} جنيه من ${inst}.`,
  };
}

export function setPrice(state: OpState, day: ISODate, instrument: unknown, price: unknown, source = "manual"): OpResult {
  const inst = String(instrument ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,24}$/.test(inst)) throw new OpError("اسم الأداة مطلوب (حروف إنجليزية وأرقام).");
  const p = positive(price, "السعر");
  return { price: { date: day, instrument: inst, price: p, source }, message: `سعر ${inst} = ${qty.format(p)}.` };
}

/** Set the price so that units × price equals the balance the app shows. */
export function mark(state: OpState, day: ISODate, instrument: unknown, value: unknown): OpResult {
  const inst = instrumentOf(state, instrument);
  const v = positive(value, "القيمة");
  const units = positions(state.ledger, day).units[inst] ?? 0;
  if (units <= EPS) throw new OpError(`مفيش ${inst} مملوك في الدفتر ده بتاريخ ${day}.`);
  const price = v / units;
  return {
    price: { date: day, instrument: inst, price, source: `mark:${state.book}` },
    message: `تحديث ${inst}: ${qty.format(units)} × ${qty.format(price)} = ${money.format(v)} جنيه.`,
  };
}

/** Grow the last known price at an annual rate up to `day` (for the paper book). */
export function accrue(state: OpState, day: ISODate, instrument: unknown, rate: unknown): OpResult {
  const inst = String(instrument ?? "").trim().toUpperCase();
  const r = given(rate) ? Number(rate) : NaN;
  if (Number.isNaN(r)) throw new OpError("المعدل لازم يكون رقم، مثلًا 0.18.");
  if (!(r > -0.99 && r < 5)) throw new OpError("المعدل شكله غلط: اكتب 0.18 لو تقصد 18% في السنة.");
  const [last, when] = state.prices.get(inst, day);
  if (last === null) throw new OpError(`مفيش سعر سابق لـ ${inst}.`);
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${when}T00:00:00Z`)) / 86_400_000);
  const price = last * Math.pow(1 + r, days / 365);
  return {
    price: { date: day, instrument: inst, price, source: `accrue:${r}` },
    message: `تراكم ${inst}: ${last.toFixed(6)} ← ${price.toFixed(6)} خلال ${days} يوم بمعدل ${(r * 100).toFixed(2)}% سنويًا.`,
  };
}

const REMOVE_MESSAGES = {
  wallet: "مينفعش تتحذف: فيه عمليات بعدها بتصرف الفلوس دي. احذفها الأول.",
  units: "مينفعش تتحذف: فيه بيع بعدها معتمد على الشراء ده. احذفه الأول.",
};
const BACKDATE_MESSAGES = {
  wallet: "التاريخ ده بيخلّي الرصيد بالسالب في عمليات مسجلة بعده. راجع التاريخ أو المبلغ.",
  units: "التاريخ ده بيخلّي كمية مملوكة بالسالب في عمليات مسجلة بعده. راجع التاريخ أو الكمية.",
};

/** Walk the whole ledger in date order; the wallet and every holding must stay non-negative. */
export function checkTimeline(rows: LedgerRow[], messages: { wallet: string; units: string }): void {
  let wallet = 0;
  const units: Record<string, number> = {};
  const ordered = [...rows].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER),
  );
  for (const r of ordered) {
    if (r.type === "deposit" || r.type === "income") wallet += r.amount;
    else if (r.type === "withdraw" || r.type === "fee") wallet -= r.amount;
    else if (r.type === "buy") {
      wallet -= r.amount;
      units[r.instrument] = (units[r.instrument] ?? 0) + r.units;
    } else if (r.type === "sell") {
      wallet += r.amount;
      units[r.instrument] = (units[r.instrument] ?? 0) - r.units;
    }
    if (wallet < -TOL) throw new OpError(messages.wallet);
    if (Object.values(units).some((u) => u < -EPS)) throw new OpError(messages.units);
  }
}

/** Refuse to delete a row if that would leave the wallet or a holding negative at any point. */
export function checkRemoval(ledger: LedgerRow[], rowId: number): void {
  const rest = ledger.filter((r) => r.id !== rowId);
  if (rest.length === ledger.length) throw new OpError("العملية غير موجودة.");
  checkTimeline(rest, REMOVE_MESSAGES);
}

/** Refuse a new row whose date breaks entries that were recorded after it. */
export function checkAddition(ledger: LedgerRow[], row: Omit<LedgerRow, "id">): void {
  checkTimeline([...ledger, row], BACKDATE_MESSAGES);
}
