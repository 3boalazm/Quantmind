import "server-only";
import raw from "../../config/reviews.json";
import { valuation } from "@/lib/engine";
import { reviewStates, type ReviewLog, type ReviewResult, type ReviewsConfig, type ReviewsView, type ReviewStatus } from "@/lib/followup";
import { today } from "./config";
import type { Queryable } from "./db";
import { loadState } from "./state";

export const REVIEWS = raw as ReviewsConfig;

/** Reviews are about real instruments, so what is held and what the portfolio is worth come from the real book. */
const BOOK = "real";

interface LogRow {
  id: string;
  item: string;
  day: string;
  result: ReviewResult;
  note: string;
  next_due: string | null;
}

export async function readLog(q: Queryable): Promise<ReviewLog[]> {
  const { rows } = await q.query<LogRow>("SELECT id, item, day, result, note, next_due FROM review_log ORDER BY day, id");
  return rows.map((r) => ({ id: Number(r.id), item: r.item, date: r.day, result: r.result, note: r.note, next_due: r.next_due }));
}

/** Stores one review. False when the same submission was stored before (a retry after a lost reply). */
export async function insertLog(
  q: Queryable,
  row: { item: string; day: string; result: ReviewResult; note: string; next_due: string | null; op_id: string },
): Promise<boolean> {
  const out = await q.query(
    `INSERT INTO review_log (item, day, result, note, next_due, op_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (op_id) DO NOTHING`,
    [row.item, row.day, row.result, row.note, row.next_due, row.op_id],
  );
  return (out.rowCount ?? 0) > 0;
}

/** Removes the newest review of an item (a slip when recording). Returns what was removed. */
export async function deleteLatest(q: Queryable, item: string): Promise<boolean> {
  const out = await q.query(
    "DELETE FROM review_log WHERE id = (SELECT id FROM review_log WHERE item = $1 ORDER BY day DESC, id DESC LIMIT 1)",
    [item],
  );
  return (out.rowCount ?? 0) > 0;
}

export async function loadReviews(q: Queryable): Promise<ReviewsView> {
  const day = today();
  const state = await loadState(q, BOOK);
  const val = valuation(state.config, state.ledger, state.prices, day);
  const held = new Set(val.holdings.filter((h) => h.units > 1e-9).map((h) => h.instrument));
  const states = reviewStates(REVIEWS, await readLog(q), { today: day, total: val.total, held });
  const names: Record<string, string> = {};
  for (const [key, inst] of Object.entries(state.config.instruments)) names[key] = inst.name;
  const counts = Object.fromEntries(
    (["problem", "due", "watch", "soon", "ok", "closed", "inactive"] as ReviewStatus[]).map((status) => [status, states.filter((s) => s.status === status).length]),
  ) as Record<ReviewStatus, number>;
  return { today: day, soon_days: REVIEWS.soon_days, names, states, counts };
}
