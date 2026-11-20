/**
 * Write operations. Each one validates against the current state and returns
 * the rows to store plus a short message; nothing here touches the database.
 * Port of lab/qm/ops.py, with user-facing messages in Arabic.
 */
import { EPS, positions, type Config, type ISODate, type LedgerRow, type PriceRow, type PriceStore } from "./engine";

export const TOL = 0.005; // half a piastre

export class OpError extends Error {}

/** The entry is plausible but unusual: the caller must repeat it with `confirm: true`. */
export class ConfirmError extends OpError {}

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

/**
 * Typing mistakes in a price or a balance flow straight into every figure on the dashboard, and a
 * product's terms are easy to forget. Each check returns a sentence to confirm, or nothing. The
 * ledger records what really happened, so these ask for a second look instead of forbidding.
 */
function priceWarning(state: OpState, day: ISODate, inst: string, price: number): string | null {
  if (inst.startsWith("REF_")) return null; // reference series come from a feed, not from a keyboard
  const limit = state.config.rules.max_price_jump;
  if (!limit || limit <= 0) return null;
  const meta = state.config.instruments[inst];
  const name = meta?.name ?? inst;
  const pct = (change: number) => `${change > 0 ? "+" : "-"}${(Math.abs(change) * 100).toFixed(0)}%`;
  const [last, when] = state.prices.get(inst, day);
  if (last !== null && last > 0) {
    const change = price / last - 1;
    return Math.abs(change) > limit ? `سعر ${name} هيتغير ${pct(change)} عن آخر قراءة (${when}).` : null;
  }
  // First reading: nothing of its own to compare with.
  if (meta?.reference) {
    const [ref] = state.prices.get(meta.reference, day);
    if (ref !== null && ref > 0) {
      const change = price / ref - 1;
      return Math.abs(change) > limit ? `أول سعر لـ ${name} هو ${qty.format(price)}، وده ${pct(change)} عن السعر المرجعي (${qty.format(ref)}).` : null;
    }
  }
  if ((meta?.bucket === "cash" || meta?.fixed_price) && Math.abs(price - 1) < 1e-9) return null;
  return `ده أول سعر يتسجل لـ ${name}: ${qty.format(price)} ${meta?.unit ? `لكل ${meta.unit}` : "للوحدة"}.`;
}

function buyTermsWarning(state: OpState, day: ISODate, inst: string, amount: number): string | null {
  const meta = state.config.instruments[inst];
  const terms = meta?.terms;
  if (!terms) return null;
  const held = (positions(state.ledger, day).units[inst] ?? 0) > EPS;
  if (!held && terms.min_buy && amount < terms.min_buy - TOL) {
    return `أقل شراء لـ ${meta.name} حسب شروطه ${money.format(terms.min_buy)} جنيه.`;
  }
  if (terms.step) {
    const over = amount - (held ? 0 : terms.min_buy ?? 0);
    const remainder = Math.abs(over / terms.step - Math.round(over / terms.step));
    if (remainder > 1e-6) return `${meta.name} بتزيد بمضاعفات ${money.format(terms.step)} جنيه حسب شروطها.`;
  }
  return null;
}

/** Units bought at least `lock_days` ago, less everything already sold (oldest first). */
function sellTermsWarning(state: OpState, day: ISODate, inst: string, units: number): string | null {
  const meta = state.config.instruments[inst];
  const lock = meta?.terms?.lock_days;
  if (!lock) return null;
  const cutoff = new Date(Date.parse(`${day}T00:00:00Z`) - lock * 86_400_000).toISOString().slice(0, 10);
  let free = 0;
  for (const r of state.ledger) {
    if (r.instrument !== inst || r.date > day) continue;
    if (r.type === "buy" && r.date <= cutoff) free += r.units;
    if (r.type === "sell") free -= r.units;
  }
  if (units <= Math.max(0, free) + EPS) return null;
  return `${meta.name} بتتسترد بعد ${lock} يوم من الشراء حسب شروطها، والكمية دي لسه ما كملتش المدة.`;
}

function confirmOrThrow(warnings: Array<string | null>, confirmed: unknown): void {
  const found = warnings.filter((w): w is string => Boolean(w));
  if (found.length === 0 || confirmed === true) return;
  throw new ConfirmError(`${found.join(" ")} لو ده اللي حصل فعلًا أكّده، ولو غلطة كتابة صحّحه.`);
}

/** Booleans arrive as JSON; anything else (the text "false", 0, 1) is a caller bug, not a choice. */
function flag(value: unknown, name: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new OpError(`${name}: القيمة لازم تكون true أو false.`);
  return value;
}

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
  confirm?: unknown;
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
  confirmOrThrow([priceWarning(state, day, inst, price), buyTermsWarning(state, day, inst, amount)], flag(input.confirm, "confirm"));
  return {
    ledger: { date: day, type: "buy", instrument: inst, units, price, amount, fee, note: note(input.note) },
    price: { date: day, instrument: inst, price, source: "trade" },
    message: `شراء ${inst}: ${qty.format(units)} × ${qty.format(price)} = ${money.format(amount)} جنيه (رسوم ${money.format(fee)}).`,
  };
}

export function sell(state: OpState, day: ISODate, input: TradeInput): OpResult {
  const inst = instrumentOf(state, input.instrument);
  const held = positions(state.ledger, day).units[inst] ?? 0;
  const units = flag(input.sell_all, "sell_all") ? held : given(input.units) ? positive(input.units, "الكمية") : 0;
  if (units <= EPS || units > held + EPS) {
    throw new OpError(`المملوك من ${inst} هو ${qty.format(held)}؛ مينفعش تبيع ${qty.format(units)}.`);
  }
  const price = given(input.price) ? positive(input.price, "السعر") : state.prices.get(inst, day)[0];
  if (!price) throw new OpError(`مفيش سعر معروف لـ ${inst}: اكتب السعر.`);
  confirmOrThrow([priceWarning(state, day, inst, price), sellTermsWarning(state, day, inst, units)], flag(input.confirm, "confirm"));
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
  // A payout can arrive after the holding was sold, so "held at some point up to that day" is the test.
  const everHeld = state.ledger.some((r) => r.type === "buy" && r.instrument === inst && r.date <= day);
  if (!everHeld) {
    throw new OpError(`مفيش شراء مسجّل لـ ${state.config.instruments[inst].name} لحد ${day}، فمينفعش يتسجل منه عائد. سجّل الشراء الأول.`);
  }
  return {
    ledger: { ...blank, date: day, type: "income", instrument: inst, amount: a, note: note(text) },
    message: `تم تسجيل عائد ${money.format(a)} جنيه من ${inst}.`,
  };
}

export function setPrice(state: OpState, day: ISODate, instrument: unknown, price: unknown, source = "manual", confirmed?: unknown): OpResult {
  const inst = String(instrument ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,24}$/.test(inst)) throw new OpError("اسم الأداة مطلوب (حروف إنجليزية وأرقام).");
  const p = positive(price, "السعر");
  confirmOrThrow([priceWarning(state, day, inst, p)], flag(confirmed, "confirm"));
  return { price: { date: day, instrument: inst, price: p, source }, message: `سعر ${inst} = ${qty.format(p)}.` };
}

/** Set the price so that units × price equals the balance the app shows. */
export function mark(state: OpState, day: ISODate, instrument: unknown, value: unknown, confirmed?: unknown): OpResult {
  const inst = instrumentOf(state, instrument);
  const v = positive(value, "القيمة");
  const units = positions(state.ledger, day).units[inst] ?? 0;
  if (units <= EPS) throw new OpError(`مفيش ${inst} مملوك في الدفتر ده بتاريخ ${day}.`);
  const price = v / units;
  confirmOrThrow([priceWarning(state, day, inst, price)], flag(confirmed, "confirm"));
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
