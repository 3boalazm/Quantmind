import { describe, expect, it } from "vitest";
import * as budget from "../src/lib/budget";
import type { Account, BudgetState, Category, Entry, NewEntry } from "../src/lib/budget";
import { ConfirmError, OpError } from "../src/lib/ops";

const cat = (id: number, name: string, monthly: number, kind: Category["kind"] = "spend"): Category => ({
  id,
  name,
  monthly,
  kind,
  position: id,
  archived: false,
});

const FOOD = 1;
const CAR = 2;
const FUN = 3;
const BUFFER = 4;
const INVEST = 5;
const BANK = 1;
const CASH = 2;

const categories: Category[] = [
  cat(FOOD, "أكل", 3000),
  cat(CAR, "عربية", 1000),
  cat(FUN, "خروج", 500),
  cat(BUFFER, "عوارض", 400, "buffer"),
  cat(INVEST, "استثمار", 1600, "invest"),
];
const accounts: Account[] = [
  { id: BANK, name: "البنك", kind: "bank", position: 1, archived: false },
  { id: CASH, name: "كاش", kind: "cash", position: 2, archived: false },
];

/** A tiny in-memory budget: applies each operation's lines the way the route does. */
function book() {
  const state: BudgetState = { categories, accounts, entries: [] };
  let id = 0;
  const store = (rows: NewEntry[]) => {
    for (const row of rows) state.entries.push({ ...row, id: ++id } as Entry);
  };
  return {
    state,
    store,
    run(result: budget.BudgetResult) {
      store(result.entries);
      return result;
    },
    now: () => budget.balances(state.entries),
  };
}

function total(values: Record<number, number>): number {
  return budget.round2(Object.values(values).reduce((sum, v) => sum + v, 0));
}

function expectBalanced(b: budget.Balances) {
  expect(total(b.accounts)).toBeCloseTo(b.unallocated + total(b.categories), 2);
}

describe("cycles", () => {
  it("runs from payday to the day before the next one", () => {
    expect(budget.cycleOf(25, "2026-11-26")).toEqual({ start: "2026-11-25", end: "2026-12-24" });
    expect(budget.cycleOf(25, "2026-11-24")).toEqual({ start: "2026-10-25", end: "2026-11-24" });
    expect(budget.cycleOf(1, "2026-12-31")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(budget.cycleOf(25, "2026-01-03")).toEqual({ start: "2025-12-25", end: "2026-01-24" });
  });

  it("moves a late payday to the end of a short month", () => {
    expect(budget.cycleOf(31, "2026-02-10")).toEqual({ start: "2026-01-31", end: "2026-02-27" });
    expect(budget.cycleOf(31, "2026-02-28")).toEqual({ start: "2026-02-28", end: "2026-03-30" });
  });

  it("lists every cycle since the first entry", () => {
    const entries = [{ date: "2026-09-27" } as Entry];
    expect(budget.cyclesThrough(25, entries, "2026-11-26").map((c) => c.start)).toEqual(["2026-09-25", "2026-10-25", "2026-11-25"]);
    expect(budget.cyclesThrough(25, [], "2026-11-26")).toHaveLength(1);
  });
});

describe("salary", () => {
  it("fills the categories in order and keeps the rest unallocated", () => {
    const plan = budget.planSalary(categories, 7000);
    expect(plan.allocations.map((a) => a.amount)).toEqual([3000, 1000, 500, 400, 1600]);
    expect(plan.remaining).toBe(500);
    expect(plan.short).toEqual([]);
  });

  it("leaves the buffer's amount with the rest when it is not topped up", () => {
    const plan = budget.planSalary(categories, 7000, false);
    expect(plan.allocations.find((a) => a.category === BUFFER)).toBeUndefined();
    expect(plan.remaining).toBe(900);
  });

  it("says which categories a small salary could not fill", () => {
    const plan = budget.planSalary(categories, 4200);
    expect(plan.allocations).toEqual([
      { category: FOOD, amount: 3000 },
      { category: CAR, amount: 1000 },
      { category: FUN, amount: 200 },
    ]);
    expect(plan.short).toEqual([
      { category: FUN, amount: 300 },
      { category: BUFFER, amount: 400 },
      { category: INVEST, amount: 1600 },
    ]);
    expect(plan.remaining).toBe(0);
  });

  it("records the salary and its split in one go", () => {
    const b = book();
    const result = b.run(budget.income(b.state, "2026-11-25", { amount: 7000, account: BANK, source: "salary" }));
    expect(result.entries).toHaveLength(6);
    const now = b.now();
    expect(now.accounts[BANK]).toBe(7000);
    expect(now.unallocated).toBe(500);
    expect(now.categories[FOOD]).toBe(3000);
    expectBalanced(now);
  });

  it("keeps extra income waiting for a manual split", () => {
    const b = book();
    b.run(budget.income(b.state, "2026-11-26", { amount: 1200, account: CASH, source: "extra" }));
    expect(b.now().unallocated).toBe(1200);
    b.run(budget.allocate(b.state, "2026-11-26", [{ category: INVEST, amount: 800 }, { category: FUN, amount: "" }, { category: FOOD, amount: 100 }]));
    const now = b.now();
    expect(now.unallocated).toBe(300);
    expect(now.categories[INVEST]).toBe(800);
    expect(() => budget.allocate(b.state, "2026-11-26", [{ category: FOOD, amount: 301 }])).toThrow(OpError);
    expectBalanced(now);
  });
});

describe("spending", () => {
  function funded() {
    const b = book();
    b.run(budget.income(b.state, "2026-11-25", { amount: 6500, account: BANK, source: "salary" }));
    return b;
  }

  it("takes an expense out of its category and its account", () => {
    const b = funded();
    b.run(budget.expense(b.state, "2026-11-26", { amount: 250.5, category: FOOD, account: BANK, note: "سوبر ماركت" }));
    const now = b.now();
    expect(now.categories[FOOD]).toBe(2749.5);
    expect(now.accounts[BANK]).toBe(6249.5);
    expectBalanced(now);
  });

  it("asks before letting a category go negative", () => {
    const b = funded();
    expect(() => budget.expense(b.state, "2026-11-26", { amount: 700, category: FUN, account: BANK })).toThrow(ConfirmError);
    b.run(budget.expense(b.state, "2026-11-26", { amount: 700, category: FUN, account: BANK, confirm: true }));
    expect(b.now().categories[FUN]).toBe(-200);
  });

  it("borrows the shortfall from another category and tracks it", () => {
    const b = funded();
    const result = b.run(budget.expense(b.state, "2026-11-27", { amount: 1800, category: CAR, account: BANK, incidental: true, borrow_from: FOOD }));
    expect(result.entries.map((e) => e.type)).toEqual(["loan", "expense"]);
    const now = b.now();
    expect(now.categories[CAR]).toBe(0);
    expect(now.categories[FOOD]).toBe(2200);
    expect(now.debts).toEqual([{ borrower: CAR, lender: FOOD, amount: 800, since: "2026-11-27" }]);
    expectBalanced(now);
  });

  it("refuses a loan the lender cannot afford, or one from the investment money", () => {
    const b = funded();
    expect(() => budget.expense(b.state, "2026-11-27", { amount: 1800, category: CAR, account: BANK, borrow_from: FUN })).toThrow(/خروج/);
    expect(() => budget.expense(b.state, "2026-11-27", { amount: 1800, category: CAR, account: BANK, borrow_from: INVEST })).toThrow(OpError);
    expect(() => budget.expense(b.state, "2026-11-27", { amount: 10, category: INVEST, account: BANK })).toThrow(OpError);
  });

  it("pays a loan back, in part or in full", () => {
    const b = funded();
    b.run(budget.expense(b.state, "2026-11-27", { amount: 1800, category: CAR, account: BANK, borrow_from: FOOD }));
    expect(() => budget.repay(b.state, "2026-11-28", { borrower: CAR, lender: FOOD })).toThrow(/مش كفاية/);
    b.run(budget.shift(b.state, "2026-11-28", { from: FUN, to: CAR, amount: 300 }));
    b.run(budget.repay(b.state, "2026-11-28", { borrower: CAR, lender: FOOD, amount: 300 }));
    expect(b.now().debts[0].amount).toBe(500);
    expect(() => budget.repay(b.state, "2026-11-28", { borrower: CAR, lender: FOOD, amount: 600 })).toThrow(OpError);
    expect(() => budget.repay(b.state, "2026-11-28", { borrower: FOOD, lender: CAR })).toThrow(OpError);
  });

  it("moves money between accounts without touching the categories", () => {
    const b = funded();
    b.run(budget.move(b.state, "2026-11-26", { from: BANK, to: CASH, amount: 1000 }));
    const now = b.now();
    expect(now.accounts).toEqual({ [BANK]: 5500, [CASH]: 1000 });
    expect(now.categories[FOOD]).toBe(3000);
    expectBalanced(now);
  });
});

describe("reconcile", () => {
  it("turns missing money into an expense and surplus into waiting income", () => {
    const b = book();
    b.run(budget.income(b.state, "2026-11-25", { amount: 6500, account: BANK, source: "salary" }));
    b.run(budget.move(b.state, "2026-11-25", { from: BANK, to: CASH, amount: 1000 }));

    expect(budget.reconcile(b.state, "2026-11-30", { account: CASH, actual: 1000 }).entries).toEqual([]);
    expect(() => budget.reconcile(b.state, "2026-11-30", { account: CASH, actual: 880 })).toThrow(OpError);

    const missing = b.run(budget.reconcile(b.state, "2026-11-30", { account: CASH, actual: 880, category: FUN }));
    expect(missing.entries[0]).toMatchObject({ type: "expense", amount: 120, category: FUN, reconcile: true });
    expect(b.now().accounts[CASH]).toBe(880);

    const surplus = b.run(budget.reconcile(b.state, "2026-11-30", { account: BANK, actual: 5550 }));
    expect(surplus.entries[0]).toMatchObject({ type: "income", amount: 50, source: "reconcile" });
    expect(b.now().unallocated).toBe(50);
    expectBalanced(b.now());
  });
});

describe("month close", () => {
  const cycle = { start: "2026-10-25", end: "2026-11-24" };

  function month() {
    const b = book();
    b.run(budget.income(b.state, "2026-10-25", { amount: 6500, account: BANK, source: "salary" }));
    return b;
  }

  it("sends what is left in the spending categories to the investment category", () => {
    const b = month();
    b.run(budget.expense(b.state, "2026-11-01", { amount: 2600, category: FOOD, account: BANK }));
    b.run(budget.expense(b.state, "2026-11-02", { amount: 900, category: CAR, account: BANK }));
    b.run(budget.expense(b.state, "2026-11-03", { amount: 100, category: BUFFER, account: BANK, incidental: true }));
    const plan = budget.planClose(categories, b.state.entries, cycle);
    expect(plan).toMatchObject({ leftover: 1000, covered: 0, repaid: 0, to_invest: 1000, uncovered: 0, debts_left: 0, buffer: 300 });
    expect(plan.entries.every((e) => e.date === "2026-11-24" && e.batch === "close:2026-10-25")).toBe(true);
    b.store(plan.entries);
    const now = b.now();
    expect(now.categories).toMatchObject({ [FOOD]: 0, [CAR]: 0, [FUN]: 0, [BUFFER]: 300, [INVEST]: 2600 });
    expectBalanced(now);
  });

  it("covers overspending first, then loans, and invests only the rest", () => {
    const b = month();
    b.run(budget.expense(b.state, "2026-11-01", { amount: 2200, category: FOOD, account: BANK }));
    // The car needed 1,800: 800 lent by the food money, which then ran 300 over itself.
    b.run(budget.expense(b.state, "2026-11-05", { amount: 1800, category: CAR, account: BANK, incidental: true, borrow_from: FOOD }));
    b.run(budget.expense(b.state, "2026-11-08", { amount: 300, category: FOOD, account: BANK, confirm: true }));
    // Going out ran 150 over.
    b.run(budget.expense(b.state, "2026-11-10", { amount: 650, category: FUN, account: BANK, confirm: true }));
    const before = b.now();
    expect(before.categories).toMatchObject({ [FOOD]: -300, [CAR]: 0, [FUN]: -150 });

    const plan = budget.planClose(categories, b.state.entries, cycle);
    // Nothing is left anywhere: the overspending and the loan carry into the next cycle.
    expect(plan).toMatchObject({ leftover: 0, covered: 0, repaid: 0, to_invest: 0, uncovered: 450, debts_left: 800 });
    expect(plan.entries).toEqual([]);
  });

  it("repays a loan out of other categories' leftovers before investing", () => {
    const b = month();
    b.run(budget.expense(b.state, "2026-11-01", { amount: 1500, category: FOOD, account: BANK }));
    b.run(budget.expense(b.state, "2026-11-05", { amount: 1300, category: CAR, account: BANK, borrow_from: FOOD }));
    b.run(budget.expense(b.state, "2026-11-10", { amount: 700, category: FUN, account: BANK, confirm: true }));
    // Food: 3000 − 1500 − 300 lent = 1200 left. Car: 0, owes 300. Fun: −200.
    const plan = budget.planClose(categories, b.state.entries, cycle);
    // 200 covers the overspending. The lender's own leftover never repays itself, so the loan stays open.
    expect(plan).toMatchObject({ leftover: 1200, covered: 200, repaid: 0, debts_left: 300, to_invest: 1000, uncovered: 0 });
    b.store(plan.entries);
    expect(b.now().categories).toMatchObject({ [FOOD]: 0, [FUN]: 0, [INVEST]: 2600 });
    expectBalanced(b.now());
  });

  it("uses a third category's leftover to settle a loan, and the lender keeps what it gets back", () => {
    const b = month();
    b.run(budget.expense(b.state, "2026-11-01", { amount: 3000, category: FOOD, account: BANK }));
    b.run(budget.shift(b.state, "2026-11-02", { from: BUFFER, to: FOOD, amount: 250, loan: true }));
    b.run(budget.expense(b.state, "2026-11-03", { amount: 250, category: FOOD, account: BANK }));
    // Car and going out are untouched: 1,500 left. Food owes the buffer 250.
    const plan = budget.planClose(categories, b.state.entries, cycle);
    expect(plan).toMatchObject({ leftover: 1500, repaid: 250, debts_left: 0, to_invest: 1250 });
    b.store(plan.entries);
    const now = b.now();
    expect(now.debts).toEqual([]);
    expect(now.categories).toMatchObject({ [FOOD]: 0, [CAR]: 0, [FUN]: 0, [BUFFER]: 400, [INVEST]: 2850 });
    expectBalanced(now);
  });

  it("ignores what happened after the cycle ended", () => {
    const b = month();
    b.run(budget.expense(b.state, "2026-11-01", { amount: 2000, category: FOOD, account: BANK }));
    b.run(budget.income(b.state, "2026-11-25", { amount: 6500, account: BANK, source: "salary" }));
    b.run(budget.expense(b.state, "2026-11-26", { amount: 400, category: FOOD, account: BANK }));
    const plan = budget.planClose(categories, b.state.entries, cycle);
    expect(plan.to_invest).toBe(2500);
    b.store(plan.entries);
    expect(b.now().categories).toMatchObject({ [FOOD]: 2600, [CAR]: 1000, [FUN]: 500, [INVEST]: 5700 });
  });
});

describe("investing", () => {
  it("hands the ready amount to the portfolio and never more", () => {
    const b = book();
    b.run(budget.income(b.state, "2026-11-25", { amount: 6500, account: BANK, source: "salary" }));
    expect(() => budget.invest(b.state, "2026-11-26", { amount: 1700, account: BANK })).toThrow(OpError);
    const result = b.run(budget.invest(b.state, "2026-11-26", { account: BANK }));
    expect(result.entries[0]).toMatchObject({ type: "invest", amount: 1600, category: INVEST, account: BANK });
    expect(b.now().categories[INVEST]).toBe(0);
    expect(() => budget.invest(b.state, "2026-11-26", { account: BANK })).toThrow(OpError);
    expectBalanced(b.now());
  });
});

describe("reports", () => {
  it("shows spending against the allocation, incidentals, loans and the investment rate", () => {
    const b = book();
    b.run(budget.income(b.state, "2026-10-25", { amount: 6500, account: BANK, source: "salary" }));
    b.run(budget.income(b.state, "2026-10-30", { amount: 1500, account: BANK, source: "extra" }));
    b.run(budget.allocate(b.state, "2026-10-30", [{ category: INVEST, amount: 1000 }]));
    b.run(budget.expense(b.state, "2026-11-01", { amount: 2600, category: FOOD, account: BANK }));
    b.run(budget.expense(b.state, "2026-11-05", { amount: 1400, category: CAR, account: BANK, incidental: true, borrow_from: FUN }));
    const cycle = budget.cycleOf(25, "2026-11-01");
    b.store(budget.planClose(categories, b.state.entries, cycle).entries);

    const report = budget.cycleReport(categories, b.state.entries, cycle);
    expect(report.income).toEqual({ salary: 6500, extra: 1500, other: 0, total: 8000 });
    expect(report.spent).toBe(4000);
    expect(report.incidental).toEqual({ total: 1400, count: 1 });
    expect(report.loans).toEqual([{ date: "2026-11-05", lender: FUN, borrower: CAR, amount: 400 }]);
    const food = report.lines.find((l) => l.category === FOOD)!;
    expect(food).toMatchObject({ allocated: 3000, spent: 2600, closing: 0 });
    // 1,600 from the salary and 1,000 by hand. At the close food had 400 left and going out 100:
    // food's 400 repaid the car's loan, and going out (the lender) sent its own 100 to investing.
    expect(report.invested).toBe(2700);
    expect(report.invest_rate).toBeCloseTo(2700 / 8000, 6);
  });

  it("suggests a new amount only when the gap repeats", () => {
    const b = book();
    for (const [day, amount] of [["2026-08-26", 3400], ["2026-09-26", 3300], ["2026-10-26", 3500], ["2026-11-26", 3350]] as const) {
      b.store([{ ...blank, date: day, type: "expense", amount, category: FOOD, account: BANK }]);
      b.store([{ ...blank, date: day, type: "expense", amount: 300, category: FUN, account: BANK }]);
      b.store([{ ...blank, date: day, type: "expense", amount: day === "2026-10-26" ? 1500 : 900, category: CAR, account: BANK }]);
    }
    const list = budget.trends(categories, b.state.entries, 25, budget.cycleOf(25, "2026-11-26"));
    const food = list.find((t) => t.category === FOOD)!;
    expect(food.previous).toEqual([3500, 3300, 3400]);
    expect(food.average).toBe(3400);
    expect(food.suggestion).toEqual({ monthly: 3400, reason: "over" });
    expect(list.find((t) => t.category === FUN)!.suggestion).toEqual({ monthly: 300, reason: "under" });
    expect(list.find((t) => t.category === CAR)!.suggestion).toBeNull();
  });

  it("offers no suggestion from a single cycle", () => {
    const b = book();
    b.store([{ ...blank, date: "2026-11-26", type: "expense", amount: 4000, category: FOOD, account: BANK }]);
    const list = budget.trends(categories, b.state.entries, 25, budget.cycleOf(25, "2026-11-26"));
    expect(list[0]).toMatchObject({ previous: [], average: null, suggestion: null });
  });
});

describe("removing a line", () => {
  it("removes what one submission wrote, and protects what later lines rely on", () => {
    const b = book();
    const submit = (op: string, result: budget.BudgetResult) => {
      const from = b.state.entries.length;
      b.run(result);
      for (const e of b.state.entries.slice(from)) e.op = op;
    };
    submit("salary", budget.income(b.state, "2026-11-25", { amount: 6500, account: BANK, source: "salary" }));
    const salary = b.state.entries[0].id!;
    // The salary goes together with its split.
    expect(budget.checkRemoval(b.state, salary)).toHaveLength(6);

    submit("loan", budget.shift(b.state, "2026-11-26", { from: FOOD, to: CAR, amount: 200, loan: true }));
    const loan = b.state.entries.at(-1)!.id!;
    submit("repay", budget.repay(b.state, "2026-11-27", { borrower: CAR, lender: FOOD }));
    expect(() => budget.checkRemoval(b.state, loan)).toThrow(/اتردّت/);
    expect(budget.checkRemoval(b.state, b.state.entries.at(-1)!.id!).map((e) => e.type)).toEqual(["repay"]);

    submit("invest", budget.invest(b.state, "2026-11-27", { account: BANK }));
    expect(() => budget.checkRemoval(b.state, salary)).toThrow(/محفظة/);
    expect(() => budget.checkRemoval(b.state, 9999)).toThrow(OpError);
    expect(() => budget.checkRemoval(b.state, loan, "2026-11-30")).toThrow(/مقفول/);
  });

  it("undoes a close as a whole, unless its money was already invested", () => {
    const b = book();
    const cycle = { start: "2026-10-25", end: "2026-11-24" };
    b.run(budget.income(b.state, "2026-10-25", { amount: 6500, account: BANK, source: "salary" }));
    b.run(budget.invest(b.state, "2026-10-26", { account: BANK }));
    b.store(budget.planClose(categories, b.state.entries, cycle).entries);
    expect(() => budget.checkRemoval(b.state, b.state.entries.at(-1)!.id!)).toThrow(/إقفال/);
    expect(budget.checkUndoClose(b.state, cycle)).toHaveLength(3);
    b.run(budget.invest(b.state, "2026-11-25", { account: BANK }));
    expect(() => budget.checkUndoClose(b.state, cycle)).toThrow(/محفظة/);
    expect(() => budget.assertOpen("2026-11-24", "2026-11-24")).toThrow(/مقفول/);
    expect(() => budget.assertOpen("2026-11-25", "2026-11-24")).not.toThrow();
  });
});

describe("view", () => {
  it("offers the oldest ended cycle for closing and reports on the chosen one", () => {
    const b = book();
    b.run(budget.income(b.state, "2026-09-25", { amount: 6500, account: BANK, source: "salary" }));
    b.run(budget.income(b.state, "2026-10-25", { amount: 6500, account: BANK, source: "salary" }));
    b.run(budget.expense(b.state, "2026-11-26", { amount: 90, category: FOOD, account: BANK }));
    const v = budget.view(b.state, 25, "2026-11-26", []);
    expect(v.ready).toBe(true);
    expect(v.cycle.start).toBe("2026-11-25");
    expect(v.cycles.map((c) => c.start)).toEqual(["2026-11-25", "2026-10-25", "2026-09-25"]);
    expect(v.pending_close?.cycle.start).toBe("2026-09-25");
    expect(v.entries).toHaveLength(1);
    expect(v.invest).toEqual({ category: INVEST, ready: 3200 });

    const closed = budget.view(b.state, 25, "2026-11-26", ["2026-09-25"], "2026-10-25");
    expect(closed.pending_close?.cycle.start).toBe("2026-10-25");
    expect(closed.last_close).toBe("2026-09-25");
    expect(closed.selected.start).toBe("2026-10-25");
    expect(closed.report.income.salary).toBe(6500);
    expect(budget.view({ ...b.state, accounts: [] }, null, "2026-11-26", []).ready).toBe(false);
  });
});

const blank = {
  category: null,
  to_category: null,
  account: null,
  to_account: null,
  source: "" as const,
  incidental: false,
  reconcile: false,
  batch: "",
  note: "",
};
