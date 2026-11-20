/** Date helpers working on ISO `YYYY-MM-DD` strings, anchored at UTC noon to avoid timezone drift. */

export function parseISODate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00.000Z`);
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

/** `month` is `YYYY-MM`. */
export function addMonths(month: string, delta: number): string {
  const date = parseISODate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return toISODate(date).slice(0, 7);
}

/** Sunday-first week containing `value`. */
export function weekDates(value: string): string[] {
  const date = parseISODate(value);
  const start = addDays(value, -date.getUTCDay());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** Six-week, Sunday-first grid for `month` (`YYYY-MM`). */
export function monthGrid(month: string): Date[] {
  const first = parseISODate(`${month}-01`);
  const start = addDays(toISODate(first), -first.getUTCDay());
  const last = parseISODate(`${addMonths(month, 1)}-01`);
  last.setUTCDate(0);
  const weeks = Math.ceil((first.getUTCDay() + last.getUTCDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => parseISODate(addDays(start, index)));
}

export function formatDate(
  value: string,
  locale: "ar" | "en",
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
): string {
  const date = parseISODate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-US", {
    timeZone: "UTC",
    ...options,
  }).format(date);
}

export function formatTime(value: string, locale: "ar" | "en"): string {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(Date.UTC(2026, 0, 1, hours, minutes));
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}
