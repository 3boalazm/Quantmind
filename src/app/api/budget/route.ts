import * as budget from "@/lib/budget";
import type { AccountKind, BudgetState, CategoryKind } from "@/lib/budget";
import * as ops from "@/lib/ops";
import { OpError } from "@/lib/ops";
import { body, dayOf, guard, handle, HttpError, ok } from "@/server/api";
import {
  claimOp,
  deleteAccount,
  deleteCategory,
  deleteClose,
  deleteEntries,
  insertClose,
  insertEntries,
  ledgerIdOfOp,
  loadBudget,
  opSeen,
  orderRows,
  readBudgetSettings,
  readCloses,
  saveAccount,
  saveCategory,
  writeBudgetSettings,
} from "@/server/budget";
import { today } from "@/server/config";
import { db, deleteLedger, insertLedger, lockBook, withBudget } from "@/server/db";
import { loadState } from "@/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The budget follows real money only, so what it invests lands in the real book. */
const BOOK = "real";

export async function GET(request: Request) {
  return handle(async () => {
    await guard(request);
    const q = await db();
    const state = await loadBudget(q);
    const settings = await readBudgetSettings(q);
    const closes = await readCloses(q);
    const selected = new URL(request.url).searchParams.get("cycle");
    return ok(budget.view(state, settings.payday ?? null, today(), closes.map((c) => c.start), selected));
  });
}

function text(value: unknown, name: string): string {
  const out = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!out) throw new OpError(`${name}: اكتب اسم.`);
  if (out.length > 40) throw new OpError(`${name}: الاسم طويل، خليه 40 حرف بالكتير.`);
  return out;
}

function idOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, "رقم غير صالح.");
  return n;
}

const CATEGORY_KINDS: CategoryKind[] = ["spend", "buffer", "invest"];
const ACCOUNT_KINDS: AccountKind[] = ["bank", "cash", "wallet"];

function categoryUsed(state: BudgetState, id: number): boolean {
  return state.entries.some((e) => e.category === id || e.to_category === id);
}

function accountUsed(state: BudgetState, id: number): boolean {
  return state.entries.some((e) => e.account === id || e.to_account === id);
}

export async function POST(request: Request) {
  return handle(async () => {
    await guard(request, true);
    const data = await body(request);
    const opId = data.op_id;
    if (typeof opId !== "string" || !/^[A-Za-z0-9:_-]{8,80}$/.test(opId)) {
      throw new HttpError(400, "معرّف العملية (op_id) مطلوب وغير صالح.");
    }
    const message = await withBudget(async (q) => {
      // The reply to an earlier attempt may have been lost: the same submission is stored once.
      if (await opSeen(q, opId)) return "العملية دي اتسجلت قبل كده ومااتكررتش.";
      const state = await loadBudget(q);
      const closes = await readCloses(q);
      const closedThrough = closes.length ? closes[closes.length - 1].end : null;
      const now = budget.balances(state.entries);

      /** Stores the lines of a money operation, once. */
      const record = async (result: budget.BudgetResult, day: string): Promise<string> => {
        budget.assertOpen(day, closedThrough);
        if (!(await claimOp(q, opId))) return "العملية دي اتسجلت قبل كده ومااتكررتش.";
        await insertEntries(q, result.entries, opId);
        return result.message;
      };
      /** Runs a setup change, once. */
      const once = async (fn: () => Promise<string>): Promise<string> => {
        if (!(await claimOp(q, opId))) return "التغيير ده اتحفظ قبل كده.";
        return fn();
      };

      switch (data.op) {
        case "income": {
          const day = dayOf(data.date);
          return record(budget.income(state, day, data), day);
        }
        case "allocate": {
          const day = dayOf(data.date);
          return record(budget.allocate(state, day, data.items), day);
        }
        case "expense": {
          const day = dayOf(data.date);
          return record(budget.expense(state, day, data), day);
        }
        case "shift": {
          const day = dayOf(data.date);
          return record(budget.shift(state, day, data), day);
        }
        case "repay": {
          const day = dayOf(data.date);
          return record(budget.repay(state, day, data), day);
        }
        case "move": {
          const day = dayOf(data.date);
          return record(budget.move(state, day, data), day);
        }
        case "reconcile": {
          const day = dayOf(data.date);
          return record(budget.reconcile(state, day, data), day);
        }
        case "invest": {
          const day = dayOf(data.date);
          const result = budget.invest(state, day, data);
          budget.assertOpen(day, closedThrough);
          if (!(await claimOp(q, opId))) return "التحويل ده اتسجل قبل كده ومااتكررش.";
          // The same amount leaves the budget and arrives in the portfolio, or neither happens.
          await lockBook(q, BOOK);
          const portfolio = await loadState(q, BOOK);
          const deposit = ops.deposit(portfolio, day, result.entries[0].amount, "من الميزانية");
          if (deposit.ledger) {
            ops.checkAddition(portfolio.ledger, deposit.ledger);
            await insertLedger(q, BOOK, deposit.ledger, opId);
          }
          await insertEntries(q, result.entries, opId);
          return result.message;
        }
        case "close": {
          const settings = await readBudgetSettings(q);
          if (!settings.payday) throw new OpError("حدّد يوم نزول المرتب الأول من إعداد الميزانية.");
          const v = budget.view(state, settings.payday, today(), closes.map((c) => c.start));
          const plan = v.pending_close;
          if (!plan) throw new OpError("مفيش شهر منتهي مستني إقفال.");
          if (data.cycle !== plan.cycle.start) throw new OpError("الشاشة قديمة: حدّث الصفحة وراجع أرقام الإقفال تاني.");
          if (!state.categories.some((c) => c.kind === "invest" && !c.archived)) {
            throw new OpError("عرّف فئة الاستثمار الأول من إعداد الميزانية علشان الباقي يروح لها.");
          }
          return once(async () => {
            await insertEntries(q, plan.entries, opId);
            await insertClose(q, plan.cycle.start, plan.cycle.end);
            const parts = ["اتقفل الشهر."];
            if (plan.to_invest > 0) parts.push(`${plan.to_invest.toLocaleString("en-US")} جنيه بقوا جاهزين للاستثمار.`);
            if (plan.uncovered > 0) parts.push(`${plan.uncovered.toLocaleString("en-US")} جنيه زيادة صرف اترحّلت للشهر الجديد.`);
            if (plan.debts_left > 0) parts.push(`${plan.debts_left.toLocaleString("en-US")} جنيه سلف لسه مفتوحة.`);
            return parts.join(" ");
          });
        }
        case "undo_close": {
          const last = closes[closes.length - 1];
          if (!last) throw new OpError("مفيش شهر مقفول.");
          const rows = budget.checkUndoClose(state, last);
          return once(async () => {
            await deleteEntries(q, rows.map((e) => e.id as number));
            await deleteClose(q, last.start);
            return "اتلغى إقفال آخر شهر، ورجعت الأرصدة زي ما كانت قبله.";
          });
        }
        case "delete": {
          const id = idOrNull(data.id);
          if (id === null) throw new HttpError(400, "رقم الحركة غير صالح.");
          const rows = budget.checkRemoval(state, id, closedThrough);
          const invested = rows.find((e) => e.type === "invest");
          return once(async () => {
            if (invested?.op) {
              await lockBook(q, BOOK);
              const ledgerId = await ledgerIdOfOp(q, BOOK, invested.op);
              if (ledgerId !== null) {
                const portfolio = await loadState(q, BOOK);
                ops.checkRemoval(portfolio.ledger, ledgerId);
                await deleteLedger(q, BOOK, ledgerId);
              }
            }
            await deleteEntries(q, rows.map((e) => e.id as number));
            return rows.length > 1 ? `اتحذفت الحركة ومعاها ${rows.length - 1} حركة مرتبطة بيها.` : "اتحذفت الحركة.";
          });
        }
        case "category_save": {
          const id = idOrNull(data.id);
          const current = id === null ? null : state.categories.find((c) => c.id === id);
          if (id !== null && !current) throw new OpError("الفئة دي مش موجودة.");
          const name = text(data.name, "اسم الفئة");
          const monthly = data.monthly === "" || data.monthly === undefined || data.monthly === null ? 0 : Number(data.monthly);
          if (!Number.isFinite(monthly) || monthly < 0 || monthly > 1e9) throw new OpError("المبلغ الشهري: لازم يكون رقم صفر أو أكبر.");
          const kind = CATEGORY_KINDS.includes(data.kind as CategoryKind) ? (data.kind as CategoryKind) : (current?.kind ?? "spend");
          const archived = current ? data.archived === true : false;
          if (state.categories.some((c) => c.id !== id && !c.archived && c.name === name) && !archived) throw new OpError(`فيه فئة باسم «${name}» فعلًا.`);
          if (kind === "invest" && !archived && state.categories.some((c) => c.id !== id && c.kind === "invest" && !c.archived)) {
            throw new OpError("فيه فئة استثمار واحدة بس: هي اللي بتتحول منها الفلوس للمحفظة.");
          }
          if (current && current.kind !== kind && (current.kind === "invest" || kind === "invest") && categoryUsed(state, current.id)) {
            throw new OpError("الفئة دي عليها حركات، فمينفعش نوعها يتغيّر من أو إلى «استثمار». اعمل فئة جديدة.");
          }
          if (current && archived && !current.archived) {
            if (Math.abs(now.categories[current.id] ?? 0) >= ops.TOL) throw new OpError(`«${current.name}» لسه فيها رصيد. حوّله لفئة تانية الأول.`);
            if (now.debts.some((d) => d.borrower === current.id || d.lender === current.id)) throw new OpError(`«${current.name}» عليها سلفة مفتوحة. سدّدها الأول.`);
          }
          return once(async () => {
            await saveCategory(q, { id, name, monthly: budget.round2(monthly), kind, archived });
            return id === null ? `اتضافت فئة «${name}».` : archived ? `«${name}» اتأرشفت.` : `اتحفظت «${name}».`;
          });
        }
        case "category_delete": {
          const id = idOrNull(data.id);
          const current = state.categories.find((c) => c.id === id);
          if (!current) throw new OpError("الفئة دي مش موجودة.");
          if (categoryUsed(state, current.id)) throw new OpError(`«${current.name}» عليها حركات، فمتتحذفش. أرشفها بدل الحذف.`);
          return once(async () => {
            await deleteCategory(q, current.id);
            return `اتحذفت «${current.name}».`;
          });
        }
        case "account_save": {
          const id = idOrNull(data.id);
          const current = id === null ? null : state.accounts.find((a) => a.id === id);
          if (id !== null && !current) throw new OpError("الحساب ده مش موجود.");
          const name = text(data.name, "اسم الحساب");
          const kind = ACCOUNT_KINDS.includes(data.kind as AccountKind) ? (data.kind as AccountKind) : (current?.kind ?? "cash");
          const archived = current ? data.archived === true : false;
          if (state.accounts.some((a) => a.id !== id && !a.archived && a.name === name) && !archived) throw new OpError(`فيه حساب باسم «${name}» فعلًا.`);
          if (current && archived && !current.archived && Math.abs(now.accounts[current.id] ?? 0) >= ops.TOL) {
            throw new OpError(`«${current.name}» لسه فيه رصيد. انقله لحساب تاني الأول.`);
          }
          return once(async () => {
            await saveAccount(q, { id, name, kind, archived });
            return id === null ? `اتضاف حساب «${name}».` : archived ? `«${name}» اتأرشف.` : `اتحفظ «${name}».`;
          });
        }
        case "account_delete": {
          const id = idOrNull(data.id);
          const current = state.accounts.find((a) => a.id === id);
          if (!current) throw new OpError("الحساب ده مش موجود.");
          if (accountUsed(state, current.id)) throw new OpError(`«${current.name}» عليه حركات، فميتحذفش. أرشفه بدل الحذف.`);
          return once(async () => {
            await deleteAccount(q, current.id);
            return `اتحذف «${current.name}».`;
          });
        }
        case "order": {
          const table = data.what === "accounts" ? "budget_accounts" : data.what === "categories" ? "budget_categories" : null;
          if (!table || !Array.isArray(data.ids)) throw new HttpError(400, "ترتيب غير صالح.");
          const known = new Set((table === "budget_accounts" ? state.accounts : state.categories).map((r) => r.id));
          const ids = (data.ids as unknown[]).map(Number).filter((n) => known.has(n));
          if (ids.length !== known.size || new Set(ids).size !== ids.length) throw new HttpError(400, "ترتيب غير صالح.");
          return once(async () => {
            await orderRows(q, table, ids);
            return "اتحفظ الترتيب.";
          });
        }
        case "settings_save": {
          const payday = Number(data.payday);
          if (!Number.isInteger(payday) || payday < 1 || payday > 31) throw new OpError("يوم نزول المرتب: رقم من 1 لـ 31.");
          const settings = await readBudgetSettings(q);
          if (closes.length && settings.payday && settings.payday !== payday) {
            throw new OpError("فيه شهور اتقفلت على يوم المرتب الحالي. تغيير اليوم هيلخبط حدودها.");
          }
          return once(async () => {
            await writeBudgetSettings(q, { ...settings, payday });
            return `الشهر المالي بيبدأ يوم ${payday}.`;
          });
        }
        default:
          throw new HttpError(400, "نوع العملية غير معروف.");
      }
    });
    return ok({ ok: true, message });
  });
}
