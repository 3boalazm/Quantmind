/**
 * What a phone notification about reviews says, and when it is worth sending. Pure.
 *
 * A notification goes out when something newly waits on the person (an item whose day came, or a new
 * problem), or when the same things have waited for a few days. It does not repeat daily for the same list.
 */
import { daysBetween, pending, type ISODate, type ReviewState } from "./followup";

/** How long the same waiting list is left alone before a reminder. */
export const REMIND_AFTER_DAYS = 3;

/** What was sent last time: the day, and which waits it covered. */
export interface NoticeMemory {
  at: ISODate;
  keys: string[];
}

export interface Notice {
  title: string;
  body: string;
  /** Where tapping the notification goes. */
  url: string;
  /** Every wait it covers, to keep as the memory once it is sent. */
  keys: string[];
}

/**
 * One wait: an item and the day it waits on. Rescheduling or a fresh review makes a new key, so a repeat of the
 * same item later counts as new; an open problem is keyed by the review that raised it.
 */
export function waitKey(state: ReviewState): string {
  return state.status === "problem" ? `${state.item.id}:problem:${state.last?.id ?? 0}` : `${state.item.id}:${state.due ?? ""}`;
}

export function reviewNotice(states: ReviewState[], memory: NoticeMemory | null, today: ISODate): Notice | null {
  const waiting = pending(states);
  if (waiting.length === 0) return null;
  const keys = waiting.map(waitKey);
  const seen = new Set(memory?.keys ?? []);
  const fresh = keys.some((key) => !seen.has(key));
  const stale = memory === null || daysBetween(memory.at, today) >= REMIND_AFTER_DAYS;
  if (!fresh && !stale) return null;

  const problems = waiting.filter((s) => s.status === "problem");
  const due = waiting.length - problems.length;
  const counts = [problems.length ? `${problems.length} مشكلة مفتوحة` : "", due ? `${due} مراجعة مستحقة` : ""].filter(Boolean).join(" و");
  const names = waiting.slice(0, 2).map((s) => `«${s.item.title}»`).join("، ");
  const more = waiting.length > 2 ? ` و${waiting.length - 2} كمان` : "";
  return { title: "QuantMind · المتابعة", body: `${counts}: ${names}${more}.`, url: "/follow-up", keys };
}
