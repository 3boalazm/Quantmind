/**
 * Periodic reviews. Each investment has its own list of things only a person can check (an answer from
 * support, a fact sheet, a ruling). This module works out which of them are due, and what a review's
 * outcome means for the next one. Pure: the same items, log and date always give the same answer.
 */
import { addDays, parseISODate } from "./dates";

export type ISODate = string;

/** `ok`: checked, nothing to do. `watch`: still waiting or unclear. `problem`: something is wrong. */
export type ReviewResult = "ok" | "watch" | "problem";

export const RESULTS: ReviewResult[] = ["ok", "watch", "problem"];

export interface ReviewItem {
  id: string;
  /** Instrument key from the portfolio config, or null for a review of the plan as a whole. */
  instrument: string | null;
  title: string;
  /** What to look at, one line each. */
  checks: string[];
  /** Days between reviews once one came out fine. `null`: a one-off question that closes on "ok". */
  every_days: number | null;
  /** Days from `start` to the first review. Default 0: due at once. */
  after_days?: number;
  /** Days until the next look after "watch". Default 14. */
  watch_days?: number;
  /** Days until the next look after "problem". Default 7. */
  problem_days?: number;
  /** Applies only while the instrument is held. */
  needs_holding?: boolean;
  /** Applies only once the portfolio is worth at least this much. */
  from_value?: number;
}

export interface ReviewsConfig {
  /** The day tracking began; `after_days` counts from here. */
  start: ISODate;
  /** A review this many days away or less shows as "soon". */
  soon_days: number;
  items: ReviewItem[];
}

export interface ReviewLog {
  id: number;
  item: string;
  date: ISODate;
  result: ReviewResult;
  note: string;
  /** When the next review falls; null when the review closed the item. Stored so later config changes never rewrite history. */
  next_due: ISODate | null;
}

export type ReviewStatus = "problem" | "due" | "watch" | "soon" | "ok" | "closed" | "inactive";

export interface ReviewState {
  item: ReviewItem;
  status: ReviewStatus;
  /** The day the next review falls. Null once closed, or while inactive. */
  due: ISODate | null;
  /** Days past the due day; negative while it is still ahead. */
  late: number | null;
  last: ReviewLog | null;
  /** Newest first. */
  history: ReviewLog[];
}

export interface ReviewContext {
  today: ISODate;
  /** Current value of the whole portfolio. */
  total: number;
  /** Instruments with units in the book. */
  held: ReadonlySet<string>;
}

/** What the reviews API returns: every item's state, plus what the screens need to name and count them. */
export interface ReviewsView {
  today: ISODate;
  soon_days: number;
  /** Display names of the instruments the items refer to. */
  names: Record<string, string>;
  states: ReviewState[];
  counts: Record<ReviewStatus, number>;
}

const WATCH_DAYS = 14;
const PROBLEM_DAYS = 7;
export const MAX_NEXT_DAYS = 730;

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

/**
 * When the next review falls after one on `date` with this outcome. `days` is the person's own choice and wins.
 * A one-off question closes on "ok", unless they asked to be reminded again.
 */
export function nextDue(item: ReviewItem, result: ReviewResult, date: ISODate, days?: number | null): ISODate | null {
  if (days !== undefined && days !== null) return addDays(date, days);
  if (result === "watch") return addDays(date, item.watch_days ?? WATCH_DAYS);
  if (result === "problem") return addDays(date, item.problem_days ?? PROBLEM_DAYS);
  return item.every_days === null ? null : addDays(date, item.every_days);
}

function isActive(item: ReviewItem, ctx: ReviewContext): boolean {
  if (item.needs_holding && !(item.instrument !== null && ctx.held.has(item.instrument))) return false;
  if (item.from_value !== undefined && ctx.total < item.from_value) return false;
  return true;
}

export function reviewStates(config: ReviewsConfig, log: ReviewLog[], ctx: ReviewContext): ReviewState[] {
  const byItem = new Map<string, ReviewLog[]>();
  for (const row of log) {
    const list = byItem.get(row.item);
    if (list) list.push(row);
    else byItem.set(row.item, [row]);
  }

  const states = config.items.map((item): ReviewState => {
    const history = [...(byItem.get(item.id) ?? [])].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
    const last = history[0] ?? null;

    if (!isActive(item, ctx)) return { item, status: "inactive", due: null, late: null, last, history };

    const due = last
      ? last.next_due ?? (item.every_days !== null && last.result === "ok" ? addDays(last.date, item.every_days) : null)
      : addDays(config.start, item.after_days ?? 0);
    if (due === null) return { item, status: "closed", due: null, late: null, last, history };

    const late = daysBetween(due, ctx.today);
    let status: ReviewStatus;
    if (last?.result === "problem") status = "problem";
    else if (late >= 0) status = "due";
    else if (last?.result === "watch") status = "watch";
    else if (-late <= config.soon_days) status = "soon";
    else status = "ok";
    return { item, status, due, late, last, history };
  });

  return states.sort((a, b) => rank(a) - rank(b) || (b.late ?? -1e9) - (a.late ?? -1e9));
}

const ORDER: Record<ReviewStatus, number> = { problem: 0, due: 1, watch: 2, soon: 3, ok: 4, closed: 5, inactive: 6 };
const rank = (state: ReviewState) => ORDER[state.status];

/** What is waiting on a person right now: problems that are still open, and reviews whose day has come. */
export function pending(states: ReviewState[]): ReviewState[] {
  return states.filter((s) => s.status === "problem" || s.status === "due");
}

/** Checks a config once at load, so a typo in the item list fails loudly instead of hiding a review. */
export function validateConfig(config: ReviewsConfig, knownInstruments: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const item of config.items) {
    if (!/^[a-z0-9_]+$/.test(item.id)) problems.push(`معرّف غير صالح: ${item.id}`);
    if (seen.has(item.id)) problems.push(`معرّف مكرر: ${item.id}`);
    seen.add(item.id);
    if (item.instrument !== null && !knownInstruments.has(item.instrument)) problems.push(`${item.id}: أداة غير معروفة ${item.instrument}`);
    if (item.every_days !== null && !(Number.isInteger(item.every_days) && item.every_days > 0)) problems.push(`${item.id}: every_days غير صالح`);
    if (item.needs_holding && item.instrument === null) problems.push(`${item.id}: needs_holding محتاج أداة`);
    if (item.checks.length === 0) problems.push(`${item.id}: مفيش حاجة تتراجع`);
  }
  return problems;
}
