import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PriceStore, summary, type Config, type LedgerRow, type PriceRow } from "../src/lib/engine";

interface Scenario {
  name: string;
  config: Config;
  ledger: LedgerRow[];
  prices: PriceRow[];
  asof: string;
  add: number;
  expected: Record<string, unknown>;
}

const { scenarios } = JSON.parse(readFileSync(join(__dirname, "fixtures", "golden.json"), "utf8")) as {
  scenarios: Scenario[];
};

/** Deep comparison: numbers within a relative tolerance, everything else exact. */
function diff(actual: unknown, expected: unknown, path: string, out: string[]): void {
  if (typeof expected === "number" && typeof actual === "number") {
    const tol = 1e-9 * Math.max(1, Math.abs(expected));
    if (Math.abs(actual - expected) > tol) out.push(`${path}: ${actual} != ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      out.push(`${path}: length ${Array.isArray(actual) ? actual.length : typeof actual} != ${expected.length}`);
      return;
    }
    expected.forEach((item, i) => diff(actual[i], item, `${path}[${i}]`, out));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") {
      out.push(`${path}: ${JSON.stringify(actual)} is not an object`);
      return;
    }
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(e)]);
    for (const k of keys) diff(a[k], e[k], `${path}.${k}`, out);
    return;
  }
  if (actual !== expected) out.push(`${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

/** Python's ordering of equal-target buckets is arbitrary, so compare allocation by bucket. */
function keyed(value: Record<string, unknown>): Record<string, unknown> {
  const rows = value.allocation as Array<{ bucket: string }>;
  return { ...value, allocation: Object.fromEntries(rows.map((r) => [r.bucket, r])) };
}

describe("TypeScript engine matches the Python engine", () => {
  it("has fixtures", () => expect(scenarios.length).toBeGreaterThan(20));
  for (const s of scenarios) {
    it(s.name, () => {
      const actual = JSON.parse(JSON.stringify(summary(s.config, s.ledger, new PriceStore(s.prices), s.asof, s.add)));
      const problems: string[] = [];
      diff(keyed(actual), keyed(s.expected), "summary", problems);
      expect(problems).toEqual([]);
    });
  }
});
