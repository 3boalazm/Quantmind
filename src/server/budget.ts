import "server-only";
import type { Account, AccountKind, BudgetState, Category, CategoryKind, Entry, EntryType, NewEntry } from "@/lib/budget";
import type { Queryable } from "./db";
import { readSetting, writeSetting } from "./db";

export const BUDGET_KEY = "budget";

export interface BudgetSettings {
  payday?: number;
}

export async function readBudgetSettings(q: Queryable): Promise<BudgetSettings> {
  return (await readSetting<BudgetSettings>(q, BUDGET_KEY)) ?? {};
}

export async function writeBudgetSettings(q: Queryable, value: BudgetSettings): Promise<void> {
  await writeSetting(q, BUDGET_KEY, value);
}

const num = (value: string | null) => (value === null ? null : Number(value));

export async function readCategories(q: Queryable): Promise<Category[]> {
  const { rows } = await q.query<{ id: string; name: string; monthly: number; kind: CategoryKind; position: number; archived: boolean }>(
    "SELECT id, name, monthly, kind, position, archived FROM budget_categories ORDER BY position, id",
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, monthly: r.monthly, kind: r.kind, position: r.position, archived: r.archived }));
}

export async function readAccounts(q: Queryable): Promise<Account[]> {
  const { rows } = await q.query<{ id: string; name: string; kind: AccountKind; position: number; archived: boolean }>(
    "SELECT id, name, kind, position, archived FROM budget_accounts ORDER BY position, id",
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, kind: r.kind, position: r.position, archived: r.archived }));
}

interface EntryDbRow {
  id: string;
  day: string;
  type: EntryType;
  amount: number;
  category_id: string | null;
  to_category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  source: Entry["source"];
  incidental: boolean;
  reconcile: boolean;
  batch: string;
  note: string;
  op_id: string | null;
}

export async function readEntries(q: Queryable): Promise<Entry[]> {
  const { rows } = await q.query<EntryDbRow>(
    `SELECT id, day, type, amount, category_id, to_category_id, account_id, to_account_id,
            source, incidental, reconcile, batch, note, op_id
       FROM budget_entries ORDER BY day, id`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    date: r.day,
    type: r.type,
    amount: r.amount,
    category: num(r.category_id),
    to_category: num(r.to_category_id),
    account: num(r.account_id),
    to_account: num(r.to_account_id),
    source: r.source,
    incidental: r.incidental,
    reconcile: r.reconcile,
    batch: r.batch,
    note: r.note,
    op: r.op_id,
  }));
}

export async function insertEntries(q: Queryable, rows: NewEntry[], opId: string): Promise<void> {
  for (const row of rows) {
    await q.query(
      `INSERT INTO budget_entries
         (day, type, amount, category_id, to_category_id, account_id, to_account_id, source, incidental, reconcile, batch, note, op_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [row.date, row.type, row.amount, row.category, row.to_category, row.account, row.to_account, row.source, row.incidental, row.reconcile, row.batch, row.note, opId],
    );
  }
}

export async function deleteEntries(q: Queryable, ids: number[]): Promise<void> {
  if (ids.length) await q.query("DELETE FROM budget_entries WHERE id = ANY($1::bigint[])", [ids]);
}

/** Closed cycles by their first day, oldest first. */
export async function readCloses(q: Queryable): Promise<Array<{ start: string; end: string }>> {
  const { rows } = await q.query<{ cycle_start: string; cycle_end: string }>("SELECT cycle_start, cycle_end FROM budget_closes ORDER BY cycle_start");
  return rows.map((r) => ({ start: r.cycle_start, end: r.cycle_end }));
}

export async function insertClose(q: Queryable, start: string, end: string): Promise<void> {
  await q.query("INSERT INTO budget_closes (cycle_start, cycle_end) VALUES ($1, $2)", [start, end]);
}

export async function deleteClose(q: Queryable, start: string): Promise<void> {
  await q.query("DELETE FROM budget_closes WHERE cycle_start = $1", [start]);
}

export async function opSeen(q: Queryable, opId: string): Promise<boolean> {
  const { rows } = await q.query("SELECT 1 FROM budget_ops WHERE op_id = $1", [opId]);
  return rows.length > 0;
}

/** Records the submission; false when it was already stored (a retry after a lost reply). */
export async function claimOp(q: Queryable, opId: string): Promise<boolean> {
  const result = await q.query("INSERT INTO budget_ops (op_id) VALUES ($1) ON CONFLICT DO NOTHING", [opId]);
  await q.query("DELETE FROM budget_ops WHERE at < now() - interval '30 days'");
  return (result.rowCount ?? 0) > 0;
}

export async function loadBudget(q: Queryable): Promise<BudgetState> {
  const categories = await readCategories(q);
  const accounts = await readAccounts(q);
  const entries = await readEntries(q);
  return { categories, accounts, entries };
}

export async function saveCategory(q: Queryable, row: { id: number | null; name: string; monthly: number; kind: CategoryKind; archived: boolean }): Promise<void> {
  if (row.id === null) {
    await q.query(
      `INSERT INTO budget_categories (name, monthly, kind, position)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), 0) + 1 FROM budget_categories))`,
      [row.name, row.monthly, row.kind],
    );
  } else {
    await q.query("UPDATE budget_categories SET name = $2, monthly = $3, kind = $4, archived = $5 WHERE id = $1", [row.id, row.name, row.monthly, row.kind, row.archived]);
  }
}

export async function saveAccount(q: Queryable, row: { id: number | null; name: string; kind: AccountKind; archived: boolean }): Promise<void> {
  if (row.id === null) {
    await q.query(
      `INSERT INTO budget_accounts (name, kind, position)
       VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1 FROM budget_accounts))`,
      [row.name, row.kind],
    );
  } else {
    await q.query("UPDATE budget_accounts SET name = $2, kind = $3, archived = $4 WHERE id = $1", [row.id, row.name, row.kind, row.archived]);
  }
}

export async function deleteCategory(q: Queryable, id: number): Promise<void> {
  await q.query("DELETE FROM budget_categories WHERE id = $1", [id]);
}

export async function deleteAccount(q: Queryable, id: number): Promise<void> {
  await q.query("DELETE FROM budget_accounts WHERE id = $1", [id]);
}

/** Stores the order the list was dragged into. */
export async function orderRows(q: Queryable, table: "budget_categories" | "budget_accounts", ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await q.query(`UPDATE ${table} SET position = $2 WHERE id = $1`, [ids[i], i + 1]);
  }
}

/** The portfolio deposit a transfer from the budget created, if it is still there. */
export async function ledgerIdOfOp(q: Queryable, book: string, opId: string): Promise<number | null> {
  const { rows } = await q.query<{ id: string }>("SELECT id FROM ledger WHERE book = $1 AND op_id = $2 LIMIT 1", [book, opId]);
  return rows.length ? Number(rows[0].id) : null;
}

/** True when this portfolio row was created by a transfer from the budget. */
export async function ledgerRowFromBudget(q: Queryable, book: string, id: number): Promise<boolean> {
  const { rows } = await q.query(
    `SELECT 1 FROM ledger l JOIN budget_entries e ON e.op_id = l.op_id AND e.type = 'invest'
      WHERE l.book = $1 AND l.id = $2 LIMIT 1`,
    [book, id],
  );
  return rows.length > 0;
}
