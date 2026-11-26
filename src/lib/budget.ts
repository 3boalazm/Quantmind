/**
 * Personal budget: income split into categories, spending per category, loans between
 * categories, account balances, and the month close that hands what is left to the portfolio.
 *
 * Like the portfolio engine, nothing here touches the database. Every figure is derived from
 * the list of entries, so a balance can always be traced back to the lines that made it.
 *
 * Money lives in two views of the same total: where it is (accounts) and what it is for
 * (unallocated income plus the categories). The two always add up to the same amount.
 */
import { addDays, parseISODate, toISODate } from "./dates";
import { ConfirmError, OpError, TOL } from "./ops";

export type ISODate = string;

/** `buffer` is the fund for the unexpected; `invest` collects what goes to the portfolio. */
export type CategoryKind = "spend" | "buffer" | "invest";

export interface Category {
  id: number;
  name: string;
  /** The fixed amount this category receives from each salary. */
  monthly: number;
  kind: CategoryKind;
  position: number;
  archived: boolean;
}

export type AccountKind = "bank" | "cash" | "wallet";

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  position: number;
  archived: boolean;
}

export type EntryType = "income" | "allocate" | "expense" | "transfer" | "loan" | "repay" | "move" | "invest";

export type IncomeSource = "salary" | "extra" | "opening" | "reconcile";

/**
 * One line of the budget.
 *
 * income    money arrives in `account` and waits unallocated
 * allocate  unallocated money is assigned to `to_category`
 * expense   `category` pays out of `account`
 * transfer  `category` hands money to `to_category`, nothing owed
 * loan      `category` lends to `to_category`, which now owes it
 * repay     `category` (the borrower) pays back `to_category` (the lender)
 * move      money goes from `account` to `to_account`; no category changes
 * invest    `category` pays out of `account` into the portfolio
 */
export interface Entry {
  id?: number;
  date: ISODate;
  type: EntryType;
  amount: number;
  category: number | null;
  to_category: number | null;
  account: number | null;
  to_account: number | null;
  source: IncomeSource | "";
  /** An expense nobody planned for. */
  incidental: boolean;
  /** Created by matching an account against its real balance. */
  reconcile: boolean;
  /** `close:<cycle start>` on the lines a month close wrote; they are undone together. */
  batch: string;
  note: string;
  /** The submission that wrote this line. Lines written together are removed together. */
  op?: string | null;
}

export type NewEntry = Omit<Entry, "id" | "op">;

const BLANK: Omit<NewEntry, "date" | "type" | "amount"> = {
  category: null,
  to_category: null,
  account: null,
  to_account: null,
  source: "",
  incidental: false,
  reconcile: false,
  batch: "",
  note: "",
};

function line(date: ISODate, type: EntryType, amount: number, rest: Partial<NewEntry> = {}): NewEntry {
  return { ...BLANK, ...rest, date, type, amount: round2(amount) };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/* ------------------------------------------------------------------ balances */

export interface Debt {
  borrower: number;
  lender: number;
  amount: number;
  /** Date of the first loan still outstanding between the two; older debts are settled first. */
  since: ISODate;
}

export interface Balances {
  unallocated: number;
  categories: Record<number, number>;
  accounts: Record<number, number>;
  debts: Debt[];
}

/** Where everything stands at the end of `asof` (or after every entry when it is omitted). */
export function balances(entries: Entry[] | NewEntry[], asof?: ISODate): Balances {
  let unallocated = 0;
  const categories: Record<number, number> = {};
  const accounts: Record<number, number> = {};
  const owed = new Map<string, Debt>();
  const cat = (id: number | null, delta: number) => {
    if (id !== null) categories[id] = (categories[id] ?? 0) + delta;
  };
  const acc = (id: number | null, delta: number) => {
    if (id !== null) accounts[id] = (accounts[id] ?? 0) + delta;
  };
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const e of sorted) {
    if (asof && e.date > asof) continue;
    const a = e.amount;
    switch (e.type) {
      case "income":
        unallocated += a;
        acc(e.account, a);
        break;
      case "allocate":
        unallocated -= a;
        cat(e.to_category, a);
        break;
      case "expense":
      case "invest":
        cat(e.category, -a);
        acc(e.account, -a);
        break;
      case "transfer":
        cat(e.category, -a);
        cat(e.to_category, a);
        break;
      case "loan": {
        cat(e.category, -a);
        cat(e.to_category, a);
        const key = `${e.to_category}:${e.category}`;
        const debt = owed.get(key) ?? { borrower: e.to_category as number, lender: e.category as number, amount: 0, since: e.date };
        if (debt.amount < TOL) debt.since = e.date;
        debt.amount += a;
        owed.set(key, debt);
        break;
      }
      case "repay": {
        cat(e.category, -a);
        cat(e.to_category, a);
        const key = `${e.category}:${e.to_category}`;
        const debt = owed.get(key) ?? { borrower: e.category as number, lender: e.to_category as number, amount: 0, since: e.date };
        debt.amount -= a;
        owed.set(key, debt);
        break;
      }
      case "move":
        acc(e.account, -a);
        acc(e.to_account, a);
        break;
    }
  }
  const debts = [...owed.values()]
    .filter((d) => Math.abs(d.amount) >= TOL)
    .map((d) => ({ ...d, amount: round2(d.amount) }))
    .sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : a.borrower - b.borrower || a.lender - b.lender));
  for (const id of Object.keys(categories)) categories[Number(id)] = round2(categories[Number(id)]);
  for (const id of Object.keys(accounts)) accounts[Number(id)] = round2(accounts[Number(id)]);
  return { unallocated: round2(unallocated), categories, accounts, debts };
}

/* -------------------------------------------------------------------- cycles */

export interface Cycle {
  /** The payday that opens the cycle. */
  start: ISODate;
  /** The last day before the next payday. */
  end: ISODate;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The payday in the month of `date` (a payday of 31 lands on the last day of shorter months). */
function paydayIn(year: number, month: number, payday: number): ISODate {
  const date = new Date(Date.UTC(year, month, Math.min(payday, daysInMonth(year, month)), 12));
  return toISODate(date);
}

/** The salary-to-salary period that contains `date`. */
export function cycleOf(payday: number, date: ISODate): Cycle {
  const d = parseISODate(date);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth();
  let start = paydayIn(year, month, payday);
  if (start > date) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    start = paydayIn(year, month, payday);
  }
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }
  return { start, end: addDays(paydayIn(nextYear, nextMonth, payday), -1) };
}

export function previousCycle(payday: number, cycle: Cycle): Cycle {
  return cycleOf(payday, addDays(cycle.start, -1));
}

/** Every cycle from the first entry up to the one containing `today`, oldest first. */
export function cyclesThrough(payday: number, entries: Entry[], today: ISODate): Cycle[] {
  if (entries.length === 0) return [cycleOf(payday, today)];
  const first = entries.reduce((min, e) => (e.date < min ? e.date : min), entries[0].date);
  const out: Cycle[] = [];
  let cycle = cycleOf(payday, first < today ? first : today);
  const last = cycleOf(payday, today);
  for (let guard = 0; guard < 600; guard++) {
    out.push(cycle);
    if (cycle.start >= last.start) break;
    cycle = cycleOf(payday, addDays(cycle.end, 1));
  }
  return out;
}

const inCycle = (e: Entry | NewEntry, cycle: Cycle) => e.date >= cycle.start && e.date <= cycle.end;

/* ------------------------------------------------------------ salary planning */

export interface Allocation {
  category: number;
  amount: number;
}

export interface SalaryPlan {
  allocations: Allocation[];
  /** Salary left over once every category has its amount. */
  remaining: number;
  /** Categories that could not be filled because the salary ran out. */
  short: Allocation[];
}

/**
 * Fills the categories in their order, each up to its fixed amount. The buffer is optional:
 * in a month where it is not topped up, its amount stays with the rest of the salary.
 */
export function planSalary(categories: Category[], amount: number, fundBuffer = true): SalaryPlan {
  let left = amount;
  const allocations: Allocation[] = [];
  const short: Allocation[] = [];
  const order = categories.filter((c) => !c.archived && c.monthly > 0).sort((a, b) => a.position - b.position || a.id - b.id);
  for (const c of order) {
    if (c.kind === "buffer" && !fundBuffer) continue;
    const give = Math.min(c.monthly, Math.max(0, left));
    if (give >= TOL) allocations.push({ category: c.id, amount: round2(give) });
    if (give < c.monthly - TOL) short.push({ category: c.id, amount: round2(c.monthly - give) });
    left -= give;
  }
  return { allocations, remaining: round2(Math.max(0, left)), short };
}

/* -------------------------------------------------------------------- reports */

export interface CategoryLine {
  category: number;
  name: string;
  kind: CategoryKind;
  monthly: number;
  /** Balance carried in from before the cycle. */
  opening: number;
  /** Assigned from income during the cycle. */
  allocated: number;
  spent: number;
  /** The part of `spent` flagged as unplanned. */
  incidental: number;
  /** Received from other categories less handed to them (transfers, loans, repayments). */
  moved: number;
  closing: number;
}

export interface CycleReport {
  cycle: Cycle;
  lines: CategoryLine[];
  income: { salary: number; extra: number; other: number; total: number };
  allocated: number;
  spent: number;
  incidental: { total: number; count: number };
  /** Loans made during the cycle. */
  loans: Array<{ date: ISODate; lender: number; borrower: number; amount: number }>;
  /** Everything that reached the investment category in the cycle, and what share of income it is. */
  invested: number;
  invest_rate: number | null;
}

export function cycleReport(categories: Category[], entries: Entry[], cycle: Cycle): CycleReport {
  const before = balances(entries, addDays(cycle.start, -1));
  const after = balances(entries, cycle.end);
  const rows = entries.filter((e) => inCycle(e, cycle));
  const investIds = new Set(categories.filter((c) => c.kind === "invest").map((c) => c.id));
  const lines: CategoryLine[] = [];
  for (const c of [...categories].sort((a, b) => a.position - b.position || a.id - b.id)) {
    let allocated = 0;
    let spent = 0;
    let incidental = 0;
    let moved = 0;
    for (const e of rows) {
      if (e.type === "allocate" && e.to_category === c.id) allocated += e.amount;
      if ((e.type === "expense" || e.type === "invest") && e.category === c.id) {
        spent += e.amount;
        if (e.incidental) incidental += e.amount;
      }
      if (e.type === "transfer" || e.type === "loan" || e.type === "repay") {
        if (e.to_category === c.id) moved += e.amount;
        if (e.category === c.id) moved -= e.amount;
      }
    }
    const opening = before.categories[c.id] ?? 0;
    const closing = after.categories[c.id] ?? 0;
    const touched = allocated || spent || moved || Math.abs(opening) >= TOL || Math.abs(closing) >= TOL;
    if (c.archived && !touched) continue;
    lines.push({
      category: c.id,
      name: c.name,
      kind: c.kind,
      monthly: c.monthly,
      opening,
      allocated: round2(allocated),
      spent: round2(spent),
      incidental: round2(incidental),
      moved: round2(moved),
      closing,
    });
  }
  const income = { salary: 0, extra: 0, other: 0, total: 0 };
  let invested = 0;
  const incident = { total: 0, count: 0 };
  const loans: CycleReport["loans"] = [];
  for (const e of rows) {
    if (e.type === "income") {
      if (e.source === "salary") income.salary += e.amount;
      else if (e.source === "extra") income.extra += e.amount;
      else income.other += e.amount;
    }
    if (e.type === "expense" && e.incidental) {
      incident.total += e.amount;
      incident.count += 1;
    }
    if (e.type === "loan") loans.push({ date: e.date, lender: e.category as number, borrower: e.to_category as number, amount: e.amount });
    if (e.type === "allocate" && e.to_category !== null && investIds.has(e.to_category)) invested += e.amount;
    if (e.type === "transfer" || e.type === "loan" || e.type === "repay") {
      if (e.to_category !== null && investIds.has(e.to_category)) invested += e.amount;
      if (e.category !== null && investIds.has(e.category)) invested -= e.amount;
    }
  }
  income.salary = round2(income.salary);
  income.extra = round2(income.extra);
  income.other = round2(income.other);
  income.total = round2(income.salary + income.extra + income.other);
  // Opening balances and corrections are not earnings, so the rate is measured against what was earned.
  const earned = income.salary + income.extra;
  return {
    cycle,
    lines,
    income,
    allocated: round2(lines.reduce((sum, l) => sum + l.allocated, 0)),
    spent: round2(lines.filter((l) => l.kind !== "invest").reduce((sum, l) => sum + l.spent, 0)),
    incidental: { total: round2(incident.total), count: incident.count },
    loans,
    invested: round2(invested),
    invest_rate: earned >= TOL ? invested / earned : null,
  };
}

export interface Trend {
  category: number;
  name: string;
  monthly: number;
  spent: number;
  /** Spending in the cycles before this one, most recent first. */
  previous: number[];
  average: number | null;
  /** A new fixed amount, offered only when the same direction held in this cycle and the ones before it. */
  suggestion: { monthly: number; reason: "over" | "under" } | null;
}

/** Spending per category against the last `n` cycles, with a suggested amount where the gap is steady. */
export function trends(categories: Category[], entries: Entry[], payday: number, cycle: Cycle, n = 3): Trend[] {
  const past: Cycle[] = [];
  const first = entries.length ? entries.reduce((min, e) => (e.date < min ? e.date : min), entries[0].date) : cycle.start;
  let cursor = cycle;
  for (let i = 0; i < n; i++) {
    cursor = previousCycle(payday, cursor);
    if (cursor.end < first) break;
    past.push(cursor);
  }
  const spentIn = (id: number, c: Cycle) =>
    round2(entries.filter((e) => e.type === "expense" && e.category === id && inCycle(e, c)).reduce((sum, e) => sum + e.amount, 0));
  return categories
    .filter((c) => !c.archived && c.kind === "spend")
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((c) => {
      const spent = spentIn(c.id, cycle);
      const previous = past.map((p) => spentIn(c.id, p));
      const all = [spent, ...previous];
      const average = previous.length ? round2(previous.reduce((sum, v) => sum + v, 0) / previous.length) : null;
      let suggestion: Trend["suggestion"] = null;
      if (previous.length >= 2 && c.monthly > 0) {
        const mean = all.reduce((sum, v) => sum + v, 0) / all.length;
        const step = (value: number) => Math.max(50, Math.ceil(value / 50) * 50);
        if (all.every((v) => v > c.monthly + TOL)) suggestion = { monthly: step(mean), reason: "over" };
        else if (all.every((v) => v < 0.8 * c.monthly) && step(mean) < c.monthly) suggestion = { monthly: step(mean), reason: "under" };
      }
      return { category: c.id, name: c.name, monthly: c.monthly, spent, previous, average, suggestion };
    });
}

/* ---------------------------------------------------------------- month close */

export interface ClosePlan {
  cycle: Cycle;
  entries: NewEntry[];
  /** What was left in the spending categories at the end of the cycle. */
  leftover: number;
  /** Used to bring overspent categories back to zero. */
  covered: number;
  /** Used to pay back loans between categories. */
  repaid: number;
  /** What then goes to the investment category. */
  to_invest: number;
  /** Overspending the leftovers could not cover; it carries into the next cycle. */
  uncovered: number;
  /** Loans still open after the close. */
  debts_left: number;
  /** The buffer's balance, which is kept as it is. */
  buffer: number;
}

export const closeBatch = (cycle: Cycle) => `close:${cycle.start}`;

/**
 * What closing `cycle` would write, dated on its last day.
 *
 * Whatever is left in the spending categories first brings overspent categories back to zero,
 * then pays back loans between categories (oldest first), and what remains moves to the
 * investment category. The buffer keeps its balance.
 */
export function planClose(categories: Category[], entries: Entry[], cycle: Cycle): ClosePlan {
  const at = balances(entries, cycle.end);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const ordered = [...categories].sort((a, b) => a.position - b.position || a.id - b.id);
  const invest = ordered.find((c) => c.kind === "invest" && !c.archived);
  const bal = (id: number) => at.categories[id] ?? 0;
  const batch = closeBatch(cycle);
  const out: NewEntry[] = [];

  const sources = ordered.filter((c) => c.kind === "spend" && bal(c.id) >= TOL).map((c) => ({ id: c.id, left: bal(c.id) }));
  const leftover = round2(sources.reduce((sum, s) => sum + s.left, 0));

  /** Takes up to `need` from the sources and hands it to `to`. A category never pays itself or `skip`. */
  const draw = (need: number, to: number, skip: number | null, note: string): number => {
    let got = 0;
    for (const s of sources) {
      if (need - got < TOL) break;
      if (s.left < TOL || s.id === to || s.id === skip) continue;
      const take = Math.min(s.left, need - got);
      s.left -= take;
      got += take;
      out.push(line(cycle.end, "transfer", take, { category: s.id, to_category: to, batch, note }));
    }
    return got;
  };

  let covered = 0;
  let uncovered = 0;
  for (const c of ordered) {
    if (c.kind === "invest") continue;
    const deficit = -bal(c.id);
    if (deficit < TOL) continue;
    const got = draw(deficit, c.id, null, "تغطية زيادة الصرف");
    covered += got;
    uncovered += deficit - got;
  }

  let repaid = 0;
  let debtsLeft = 0;
  for (const debt of at.debts) {
    if (debt.amount < TOL) continue;
    if (!byId.has(debt.borrower) || !byId.has(debt.lender)) {
      debtsLeft += debt.amount;
      continue;
    }
    // The borrower's own leftover goes first. The lender's leftover is never used to pay itself:
    // that would cancel the debt without anybody paying it.
    const own = sources.find((s) => s.id === debt.borrower);
    let pay = 0;
    if (own && own.left >= TOL) {
      pay = Math.min(own.left, debt.amount);
      own.left -= pay;
    }
    const got = draw(debt.amount - pay, debt.borrower, debt.lender, "رد سلفة عند الإقفال");
    pay += got;
    if (pay >= TOL) {
      out.push(line(cycle.end, "repay", pay, { category: debt.borrower, to_category: debt.lender, batch, note: "رد سلفة عند الإقفال" }));
      // What the lender gets back is its own money again, not a new leftover: it carries into the next cycle.
    }
    repaid += pay;
    debtsLeft += debt.amount - pay;
  }

  let toInvest = 0;
  if (invest) {
    for (const s of sources) {
      if (s.left < TOL) continue;
      out.push(line(cycle.end, "transfer", s.left, { category: s.id, to_category: invest.id, batch, note: "باقي الشهر إلى الاستثمار" }));
      toInvest += s.left;
      s.left = 0;
    }
  }

  const buffer = ordered.filter((c) => c.kind === "buffer").reduce((sum, c) => sum + bal(c.id), 0);
  return {
    cycle,
    entries: out,
    leftover,
    covered: round2(covered),
    repaid: round2(repaid),
    to_invest: round2(toInvest),
    uncovered: round2(uncovered),
    debts_left: round2(debtsLeft),
    buffer: round2(buffer),
  };
}

/* ----------------------------------------------------------------- operations */

export interface BudgetState {
  categories: Category[];
  accounts: Account[];
  entries: Entry[];
}

export interface BudgetResult {
  entries: NewEntry[];
  message: string;
}

function amountOf(value: unknown, name = "المبلغ"): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (Number.isNaN(n)) throw new OpError(`${name}: لازم يكون رقم.`);
  if (!(n > 0) || !Number.isFinite(n)) throw new OpError(`${name}: لازم يكون أكبر من صفر.`);
  if (n > 1e10) throw new OpError(`${name}: الرقم كبير بشكل غير منطقي.`);
  return round2(n);
}

function idOf(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function categoryOf(state: BudgetState, value: unknown, name = "الفئة"): Category {
  const id = idOf(value);
  const found = id === null ? undefined : state.categories.find((c) => c.id === id);
  if (!found) throw new OpError(`${name}: اختار فئة من القائمة.`);
  if (found.archived) throw new OpError(`«${found.name}» مؤرشفة. فعّلها من الإعداد أو اختار فئة تانية.`);
  return found;
}

function accountOf(state: BudgetState, value: unknown, name = "الحساب"): Account {
  const id = idOf(value);
  const found = id === null ? undefined : state.accounts.find((a) => a.id === id);
  if (!found) throw new OpError(`${name}: اختار حساب من القائمة.`);
  if (found.archived) throw new OpError(`«${found.name}» مؤرشف. فعّله من الإعداد أو اختار حساب تاني.`);
  return found;
}

const noteOf = (value: unknown) => String(value ?? "").trim().slice(0, 200);
const yes = (value: unknown) => value === true || value === "true";

export interface IncomeInput {
  amount?: unknown;
  account?: unknown;
  source?: unknown;
  /** Salary only: split it over the categories now. */
  distribute?: unknown;
  /** Salary only: top up the buffer this month. */
  fund_buffer?: unknown;
  note?: unknown;
}

/** Money coming in. A salary is split over the categories at once; anything else waits to be distributed by hand. */
export function income(state: BudgetState, day: ISODate, input: IncomeInput): BudgetResult {
  const amount = amountOf(input.amount);
  const account = accountOf(state, input.account);
  const source = input.source === "salary" || input.source === "extra" || input.source === "opening" ? input.source : null;
  if (!source) throw new OpError("نوع الدخل غير معروف.");
  const out = [line(day, "income", amount, { account: account.id, source, note: noteOf(input.note) })];
  if (source !== "salary" || input.distribute === false) {
    return { entries: out, message: `اتسجل ${money.format(amount)} جنيه في «${account.name}». المبلغ مستني التوزيع على الفئات.` };
  }
  const plan = planSalary(state.categories, amount, input.fund_buffer !== false);
  for (const a of plan.allocations) out.push(line(day, "allocate", a.amount, { to_category: a.category, note: "توزيع المرتب" }));
  const parts = [`اتسجل المرتب (${money.format(amount)} جنيه) واتوزّع على ${plan.allocations.length} فئة.`];
  if (plan.short.length) {
    const names = plan.short.map((s) => `«${state.categories.find((c) => c.id === s.category)?.name}»`).join("، ");
    parts.push(`المرتب ماكفّاش: ناقص ${money.format(plan.short.reduce((sum, s) => sum + s.amount, 0))} جنيه في ${names}.`);
  }
  if (plan.remaining >= TOL) parts.push(`فاضل ${money.format(plan.remaining)} جنيه مستني التوزيع.`);
  return { entries: out, message: parts.join(" ") };
}

/** Assigns waiting income to categories, as much or as little of it as the list says. */
export function allocate(state: BudgetState, day: ISODate, list: unknown): BudgetResult {
  if (!Array.isArray(list) || list.length === 0) throw new OpError("اكتب مبلغ لفئة واحدة على الأقل.");
  const waiting = balances(state.entries).unallocated;
  const out: NewEntry[] = [];
  let total = 0;
  for (const item of list as Array<Record<string, unknown>>) {
    if (item?.amount === "" || item?.amount === undefined || item?.amount === null || Number(item.amount) === 0) continue;
    const category = categoryOf(state, item.category);
    const amount = amountOf(item.amount, `مبلغ «${category.name}»`);
    total += amount;
    out.push(line(day, "allocate", amount, { to_category: category.id, note: "توزيع يدوي" }));
  }
  if (out.length === 0) throw new OpError("اكتب مبلغ لفئة واحدة على الأقل.");
  if (total > waiting + TOL) {
    throw new OpError(`المجموع (${money.format(total)}) أكبر من المبلغ المستني التوزيع (${money.format(waiting)}).`);
  }
  const left = round2(waiting - total);
  return {
    entries: out,
    message: `اتوزّع ${money.format(total)} جنيه على ${out.length} فئة.${left >= TOL ? ` فاضل ${money.format(left)} جنيه من غير توزيع.` : ""}`,
  };
}

export interface ExpenseInput {
  amount?: unknown;
  category?: unknown;
  account?: unknown;
  incidental?: unknown;
  /** A category that lends the shortfall when the paying category does not hold enough. */
  borrow_from?: unknown;
  note?: unknown;
  confirm?: unknown;
}

/**
 * Money spent. When the category does not hold enough, the shortfall is either lent by
 * another category (and tracked until it is paid back) or, once confirmed, left as a
 * negative balance.
 */
export function expense(state: BudgetState, day: ISODate, input: ExpenseInput): BudgetResult {
  const amount = amountOf(input.amount);
  const category = categoryOf(state, input.category);
  const account = accountOf(state, input.account);
  if (category.kind === "invest") throw new OpError("فئة الاستثمار بتتصرف من «جاهز للاستثمار» في شاشة الإقفال، مش كمصروف.");
  const now = balances(state.entries);
  const held = now.categories[category.id] ?? 0;
  const short = round2(amount - Math.max(0, held));
  const out: NewEntry[] = [];
  const said: string[] = [];
  if (short >= TOL) {
    const lenderId = idOf(input.borrow_from);
    if (lenderId !== null) {
      const lender = categoryOf(state, lenderId, "السلفة من");
      if (lender.id === category.id) throw new OpError("مينفعش الفئة تسلّف نفسها.");
      if (lender.kind === "invest") throw new OpError("مينفعش السلفة تيجي من فئة الاستثمار.");
      const lenderHeld = now.categories[lender.id] ?? 0;
      if (lenderHeld + TOL < short) {
        throw new OpError(`«${lender.name}» فيها ${money.format(lenderHeld)} جنيه بس، والناقص ${money.format(short)}. اختار فئة تانية أو قسّم المصروف.`);
      }
      out.push(line(day, "loan", short, { category: lender.id, to_category: category.id, note: `سلفة لتغطية: ${noteOf(input.note) || category.name}` }));
      said.push(`«${category.name}» استلفت ${money.format(short)} جنيه من «${lender.name}».`);
    } else if (!yes(input.confirm)) {
      throw new ConfirmError(
        `«${category.name}» فيها ${money.format(Math.max(0, held))} جنيه والمصروف ${money.format(amount)}: ناقص ${money.format(short)}. ` +
          "لو كمّلت من غير سلفة الفئة هتبقى بالسالب.",
      );
    }
  }
  out.push(line(day, "expense", amount, { category: category.id, account: account.id, incidental: yes(input.incidental), note: noteOf(input.note) }));
  const left = round2(held + (out.length > 1 ? short : 0) - amount);
  said.unshift(`اتسجل ${money.format(amount)} جنيه من «${category.name}». الباقي فيها ${money.format(left)}.`);
  return { entries: out, message: said.join(" ") };
}

/** Hands money from one category to another, either for good or as a loan to be paid back. */
export function shift(state: BudgetState, day: ISODate, input: { from?: unknown; to?: unknown; amount?: unknown; loan?: unknown; note?: unknown }): BudgetResult {
  const amount = amountOf(input.amount);
  const from = categoryOf(state, input.from, "من فئة");
  const to = categoryOf(state, input.to, "إلى فئة");
  if (from.id === to.id) throw new OpError("اختار فئتين مختلفتين.");
  const held = balances(state.entries).categories[from.id] ?? 0;
  if (held + TOL < amount) throw new OpError(`«${from.name}» فيها ${money.format(held)} جنيه بس.`);
  const loan = yes(input.loan);
  return {
    entries: [line(day, loan ? "loan" : "transfer", amount, { category: from.id, to_category: to.id, note: noteOf(input.note) })],
    message: loan
      ? `«${to.name}» استلفت ${money.format(amount)} جنيه من «${from.name}».`
      : `اتحوّل ${money.format(amount)} جنيه من «${from.name}» إلى «${to.name}».`,
  };
}

/** Pays back part or all of what one category owes another. */
export function repay(state: BudgetState, day: ISODate, input: { borrower?: unknown; lender?: unknown; amount?: unknown }): BudgetResult {
  const borrower = categoryOf(state, input.borrower, "الفئة المدينة");
  const lender = categoryOf(state, input.lender, "الفئة الدائنة");
  const now = balances(state.entries);
  const debt = now.debts.find((d) => d.borrower === borrower.id && d.lender === lender.id);
  if (!debt || debt.amount < TOL) throw new OpError(`«${borrower.name}» مش مديونة لـ «${lender.name}».`);
  const amount = input.amount === undefined || input.amount === "" || input.amount === null ? debt.amount : amountOf(input.amount);
  if (amount > debt.amount + TOL) throw new OpError(`السلفة الباقية ${money.format(debt.amount)} جنيه بس.`);
  const held = now.categories[borrower.id] ?? 0;
  if (held + TOL < amount) throw new OpError(`«${borrower.name}» فيها ${money.format(held)} جنيه بس، مش كفاية للرد.`);
  return {
    entries: [line(day, "repay", amount, { category: borrower.id, to_category: lender.id })],
    message: `«${borrower.name}» ردّت ${money.format(amount)} جنيه لـ «${lender.name}».`,
  };
}

/** Moves money between two places (a cash withdrawal, a top-up of the wallet). Categories do not change. */
export function move(state: BudgetState, day: ISODate, input: { from?: unknown; to?: unknown; amount?: unknown; note?: unknown }): BudgetResult {
  const amount = amountOf(input.amount);
  const from = accountOf(state, input.from, "من حساب");
  const to = accountOf(state, input.to, "إلى حساب");
  if (from.id === to.id) throw new OpError("اختار حسابين مختلفين.");
  return {
    entries: [line(day, "move", amount, { account: from.id, to_account: to.id, note: noteOf(input.note) })],
    message: `اتنقل ${money.format(amount)} جنيه من «${from.name}» إلى «${to.name}».`,
  };
}

/**
 * Matches an account against what it really holds. Money that is missing was spent and never
 * written down, so it becomes an expense of the chosen category; money that should not be
 * there is income waiting to be distributed.
 */
export function reconcile(state: BudgetState, day: ISODate, input: { account?: unknown; actual?: unknown; category?: unknown }): BudgetResult {
  const account = accountOf(state, input.account);
  const actual = typeof input.actual === "number" ? input.actual : typeof input.actual === "string" && input.actual.trim() !== "" ? Number(input.actual) : NaN;
  if (!Number.isFinite(actual) || actual < 0 || actual > 1e10) throw new OpError("الرصيد الفعلي: لازم يكون رقم صفر أو أكبر.");
  const expected = balances(state.entries).accounts[account.id] ?? 0;
  const gap = round2(expected - actual);
  if (Math.abs(gap) < TOL) return { entries: [], message: `«${account.name}» مطابق: ${money.format(expected)} جنيه.` };
  if (gap > 0) {
    const category = categoryOf(state, input.category, "فئة المصروف غير المسجل");
    if (category.kind === "invest") throw new OpError("اختار فئة صرف، مش فئة الاستثمار.");
    return {
      entries: [line(day, "expense", gap, { category: category.id, account: account.id, reconcile: true, note: "مصروف غير مسجل (مطابقة)" })],
      message: `«${account.name}» ناقص ${money.format(gap)} جنيه عن المسجل. اتسجلوا مصروف على «${category.name}».`,
    };
  }
  return {
    entries: [line(day, "income", -gap, { account: account.id, source: "reconcile", reconcile: true, note: "زيادة عن المسجل (مطابقة)" })],
    message: `«${account.name}» فيه ${money.format(-gap)} جنيه زيادة عن المسجل. اتضافوا للمبلغ المستني التوزيع.`,
  };
}

/** Takes money out of the investment category to become a deposit in the portfolio. */
export function invest(state: BudgetState, day: ISODate, input: { amount?: unknown; account?: unknown }): BudgetResult {
  const category = state.categories.find((c) => c.kind === "invest" && !c.archived);
  if (!category) throw new OpError("عرّف فئة الاستثمار الأول من إعداد الميزانية.");
  const account = accountOf(state, input.account);
  const ready = balances(state.entries).categories[category.id] ?? 0;
  if (ready < TOL) throw new OpError("مفيش مبلغ جاهز للاستثمار دلوقتي.");
  const amount = input.amount === undefined || input.amount === "" || input.amount === null ? ready : amountOf(input.amount);
  if (amount > ready + TOL) throw new OpError(`الجاهز للاستثمار ${money.format(ready)} جنيه بس.`);
  return {
    entries: [line(day, "invest", amount, { category: category.id, account: account.id, note: "تحويل للمحفظة" })],
    message: `اتحوّل ${money.format(amount)} جنيه من «${account.name}» وبقى إيداع في المحفظة. افتح خطة الشراء علشان توزّعه.`,
  };
}

/** A budget that could not have come about: more assigned than came in, a loan repaid twice, invested money that was never there. */
function assertPossible(state: BudgetState, after: Entry[]): void {
  const now = balances(after);
  if (now.unallocated < -TOL) throw new OpError("الدخل ده اتوزّع على الفئات. احذف التوزيع الأول.");
  if (now.debts.some((d) => d.amount < -TOL)) throw new OpError("السلفة دي اتردّت. احذف الرد الأول.");
  const before = balances(state.entries);
  for (const c of state.categories) {
    if (c.kind !== "invest") continue;
    const was = before.categories[c.id] ?? 0;
    const is = now.categories[c.id] ?? 0;
    if (is < -TOL && is < was - TOL) throw new OpError("المبلغ ده اتحوّل للمحفظة فعلًا. احذف التحويل للمحفظة الأول.");
  }
}

/**
 * Removing a line takes everything its submission wrote with it (a salary and its split, an
 * expense and the loan that covered it), and must not leave a budget that never existed.
 */
export function checkRemoval(state: BudgetState, id: number, closedThrough: ISODate | null = null): Entry[] {
  const row = state.entries.find((e) => e.id === id);
  if (!row) throw new OpError("الحركة دي مش موجودة.");
  if (row.batch) throw new OpError("الحركة دي من إقفال شهر. تراجع عن الإقفال كله من شاشة الإقفال.");
  const group = row.op ? state.entries.filter((e) => e.op === row.op && !e.batch) : [row];
  if (closedThrough && group.some((e) => e.date <= closedThrough)) {
    throw new OpError("الحركة دي في شهر مقفول. تراجع عن الإقفال الأول.");
  }
  const gone = new Set(group.map((e) => e.id));
  assertPossible(state, state.entries.filter((e) => !gone.has(e.id)));
  return group;
}

/** Undoing a close removes every line it wrote, as long as nothing since has relied on them. */
export function checkUndoClose(state: BudgetState, cycle: Cycle): Entry[] {
  const batch = closeBatch(cycle);
  const group = state.entries.filter((e) => e.batch === batch);
  assertPossible(state, state.entries.filter((e) => e.batch !== batch));
  return group;
}

/** New lines may not land in a month that is already closed. */
export function assertOpen(day: ISODate, closedThrough: ISODate | null): void {
  if (closedThrough && day <= closedThrough) {
    throw new OpError("التاريخ ده في شهر مقفول. سجّل بتاريخ بعده، أو تراجع عن الإقفال الأول.");
  }
}

/* ----------------------------------------------------------------------- view */

export interface BudgetView {
  today: ISODate;
  /** Day of the month the salary arrives; null until it is set. */
  payday: number | null;
  /** True once there is a payday, an account and a category to work with. */
  ready: boolean;
  categories: Category[];
  accounts: Account[];
  balances: Balances;
  /** The cycle that contains today. */
  cycle: Cycle;
  /** Every cycle with its state, newest first. */
  cycles: Array<Cycle & { closed: boolean }>;
  /** The cycle the report, the trends and the entries below describe. */
  selected: Cycle;
  report: CycleReport;
  trends: Trend[];
  /** The oldest cycle that has ended and is not closed yet, with what closing it would do. */
  pending_close: ClosePlan | null;
  /** Start of the most recent closed cycle; only that one can be undone. */
  last_close: ISODate | null;
  invest: { category: number | null; ready: number };
  /** Lines of the selected cycle, newest first. */
  entries: Entry[];
}

/** Everything the screens show, for the cycle starting at `selected` (or the current one). */
export function view(state: BudgetState, payday: number | null, today: ISODate, closed: ISODate[], selected?: string | null): BudgetView {
  const day = payday ?? 1;
  const entries = [...state.entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id ?? 0) - (b.id ?? 0)));
  const closedSet = new Set(closed);
  const all = cyclesThrough(day, entries, today);
  const current = all[all.length - 1];
  const chosen = all.find((c) => c.start === selected) ?? current;
  const pending = all.find((c) => c.end < today && !closedSet.has(c.start));
  const now = balances(entries);
  const investCategory = state.categories.find((c) => c.kind === "invest" && !c.archived) ?? null;
  return {
    today,
    payday,
    ready: payday !== null && state.categories.some((c) => !c.archived) && state.accounts.some((a) => !a.archived),
    categories: [...state.categories].sort((a, b) => a.position - b.position || a.id - b.id),
    accounts: [...state.accounts].sort((a, b) => a.position - b.position || a.id - b.id),
    balances: now,
    cycle: current,
    cycles: all.map((c) => ({ ...c, closed: closedSet.has(c.start) })).reverse(),
    selected: chosen,
    report: cycleReport(state.categories, entries, chosen),
    trends: trends(state.categories, entries, day, chosen),
    pending_close: pending ? planClose(state.categories, entries, pending) : null,
    last_close: closed.length ? [...closed].sort().at(-1)! : null,
    invest: { category: investCategory?.id ?? null, ready: investCategory ? Math.max(0, now.categories[investCategory.id] ?? 0) : 0 },
    entries: entries.filter((e) => e.date >= chosen.start && e.date <= chosen.end).reverse(),
  };
}
