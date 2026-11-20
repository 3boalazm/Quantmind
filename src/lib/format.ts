/** Number and date formatting for the screens. Latin digits throughout, so figures stay easy to scan. */
import type { ISODate } from "./engine";

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const upTo6 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const upTo4 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

/** Whole pounds: 12,345 */
export function egp(value: number): string {
  return int.format(Math.abs(value) < 0.5 ? 0 : value);
}

/** Pounds and piastres: 12,345.60 */
export function egp2(value: number): string {
  return dec2.format(value);
}

/** Signed whole pounds with a true minus sign: +1,250 / −340 / 0 */
export function signedEgp(value: number): string {
  if (Math.abs(value) < 0.5) return "0";
  return `${value > 0 ? "+" : "−"}${int.format(Math.abs(value))}`;
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function signedPct(value: number, digits = 1): string {
  const text = (Math.abs(value) * 100).toFixed(digits);
  if (Number(text) === 0) return `${text}%`;
  return `${value > 0 ? "+" : "−"}${text}%`;
}

export function units(value: number): string {
  return upTo6.format(value);
}

export function price(value: number): string {
  return value >= 100 ? dec2.format(value) : upTo4.format(value);
}

export function formatDate(value: ISODate, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone: "UTC", ...options }).format(date);
}

/** Pieces of a sentence, with dates, percentages and signed numbers flagged so they can be shown left-to-right. */
const LTR = /\d{4}-\d{2}-\d{2}|(?<!\d)(?:[+\-−]\s?)?\d[\d,]*(?:\.\d+)?%|(?<!\d)[+\-−]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*\+/g;

export function bidiParts(text: string): Array<{ text: string; ltr: boolean }> {
  const out: Array<{ text: string; ltr: boolean }> = [];
  let last = 0;
  for (const match of text.matchAll(LTR)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: text.slice(last, index), ltr: false });
    out.push({ text: match[0], ltr: true });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), ltr: false });
  return out;
}
