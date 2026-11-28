import { describe, expect, it } from "vitest";
import {
  nextDue,
  pending,
  reviewStates,
  validateConfig,
  type ReviewContext,
  type ReviewItem,
  type ReviewLog,
  type ReviewsConfig,
} from "../src/lib/followup";

const item = (over: Partial<ReviewItem> & { id: string }): ReviewItem => ({
  instrument: "CASH",
  title: `بند ${over.id}`,
  checks: ["افحص"],
  every_days: 90,
  ...over,
});

const config = (items: ReviewItem[]): ReviewsConfig => ({ start: "2026-11-28", soon_days: 7, items });
const ctx = (over: Partial<ReviewContext> = {}): ReviewContext => ({ today: "2026-11-28", total: 2000, held: new Set(["CASH"]), ...over });

let seq = 0;
const row = (over: Partial<ReviewLog> & { item: string; date: string }): ReviewLog => ({
  id: ++seq,
  result: "ok",
  note: "",
  next_due: null,
  ...over,
});

const stateOf = (cfg: ReviewsConfig, log: ReviewLog[], c: ReviewContext, id: string) => reviewStates(cfg, log, c).find((s) => s.item.id === id)!;

describe("nextDue", () => {
  const repeating = item({ id: "r", every_days: 90 });
  const once = item({ id: "o", every_days: null });

  it("uses the item's own rhythm after a good review", () => {
    expect(nextDue(repeating, "ok", "2026-11-28")).toBe("2027-02-26");
  });
  it("checks again sooner after watch and problem, and honours per-item overrides", () => {
    expect(nextDue(repeating, "watch", "2026-11-28")).toBe("2026-12-12");
    expect(nextDue(repeating, "problem", "2026-11-28")).toBe("2026-12-05");
    expect(nextDue({ ...repeating, watch_days: 3, problem_days: 1 }, "watch", "2026-11-28")).toBe("2026-12-01");
    expect(nextDue({ ...repeating, watch_days: 3, problem_days: 1 }, "problem", "2026-11-28")).toBe("2026-11-29");
  });
  it("closes a one-off question on ok, but not on watch", () => {
    expect(nextDue(once, "ok", "2026-11-28")).toBeNull();
    expect(nextDue(once, "watch", "2026-11-28")).toBe("2026-12-12");
  });
  it("lets the person choose the day, even for a one-off", () => {
    expect(nextDue(once, "ok", "2026-11-28", 30)).toBe("2026-12-28");
    expect(nextDue(repeating, "ok", "2026-11-28", 10)).toBe("2026-12-08");
  });
});

describe("reviewStates", () => {
  it("has a never-reviewed item due from the tracking start, or after its own delay", () => {
    const cfg = config([item({ id: "now" }), item({ id: "later", after_days: 30 })]);
    expect(stateOf(cfg, [], ctx(), "now")).toMatchObject({ status: "due", due: "2026-11-28", late: 0, last: null });
    expect(stateOf(cfg, [], ctx(), "later")).toMatchObject({ status: "ok", due: "2026-12-28", late: -30 });
    expect(stateOf(cfg, [], ctx({ today: "2026-12-22" }), "later").status).toBe("soon");
    expect(stateOf(cfg, [], ctx({ today: "2026-12-28" }), "later").status).toBe("due");
  });

  it("counts how late a due review is", () => {
    const cfg = config([item({ id: "a" })]);
    expect(stateOf(cfg, [], ctx({ today: "2026-12-10" }), "a")).toMatchObject({ status: "due", late: 12 });
  });

  it("schedules from the last review, and a good one clears the due state", () => {
    const cfg = config([item({ id: "a" })]);
    const log = [row({ item: "a", date: "2026-11-28", next_due: "2027-02-26" })];
    expect(stateOf(cfg, log, ctx(), "a")).toMatchObject({ status: "ok", due: "2027-02-26" });
    expect(stateOf(cfg, log, ctx({ today: "2027-02-20" }), "a").status).toBe("soon");
    expect(stateOf(cfg, log, ctx({ today: "2027-02-26" }), "a").status).toBe("due");
  });

  it("only the newest review counts, and history is newest first", () => {
    const cfg = config([item({ id: "a" })]);
    const log = [
      row({ item: "a", date: "2026-11-28", result: "problem", next_due: "2026-12-05" }),
      row({ item: "a", date: "2026-12-05", result: "ok", next_due: "2027-03-05" }),
      row({ item: "a", date: "2026-12-01", result: "watch", next_due: "2026-12-15" }),
    ];
    const s = stateOf(cfg, log, ctx({ today: "2026-12-06" }), "a");
    expect(s.status).toBe("ok");
    expect(s.history.map((h) => h.date)).toEqual(["2026-12-05", "2026-12-01", "2026-11-28"]);
  });

  it("two reviews on the same day: the later entry wins", () => {
    const cfg = config([item({ id: "a" })]);
    const log = [
      row({ item: "a", date: "2026-12-01", result: "problem", next_due: "2026-12-08" }),
      row({ item: "a", date: "2026-12-01", result: "ok", next_due: "2027-03-01" }),
    ];
    expect(stateOf(cfg, log, ctx({ today: "2026-12-02" }), "a").last?.result).toBe("ok");
  });

  it("keeps a problem on top until a later review says otherwise, due or not", () => {
    const cfg = config([item({ id: "a" })]);
    const log = [row({ item: "a", date: "2026-11-28", result: "problem", note: "الدعم قال لا", next_due: "2026-12-05" })];
    expect(stateOf(cfg, log, ctx({ today: "2026-11-29" }), "a").status).toBe("problem");
    expect(stateOf(cfg, log, ctx({ today: "2026-12-20" }), "a")).toMatchObject({ status: "problem", late: 15 });
  });

  it("shows watch until its day comes, then due", () => {
    const cfg = config([item({ id: "a" })]);
    const log = [row({ item: "a", date: "2026-11-28", result: "watch", next_due: "2026-12-12" })];
    expect(stateOf(cfg, log, ctx({ today: "2026-12-01" }), "a").status).toBe("watch");
    expect(stateOf(cfg, log, ctx({ today: "2026-12-12" }), "a").status).toBe("due");
  });

  it("closes a one-off item and never asks again", () => {
    const cfg = config([item({ id: "o", every_days: null })]);
    const log = [row({ item: "o", date: "2026-11-30", next_due: null })];
    expect(stateOf(cfg, log, ctx({ today: "2030-01-01" }), "o")).toMatchObject({ status: "closed", due: null });
  });

  it("falls back to the item's rhythm if an old entry has no stored date", () => {
    const cfg = config([item({ id: "a", every_days: 30 })]);
    const log = [row({ item: "a", date: "2026-11-01", next_due: null })];
    // 1 Nov + 30 days = 1 Dec: three days ahead of 28 Nov, so "soon"
    expect(stateOf(cfg, log, ctx(), "a")).toMatchObject({ status: "soon", due: "2026-12-01", late: -3 });
  });

  it("holds back items whose instrument is not held or whose stage is not reached", () => {
    const cfg = config([
      item({ id: "held", instrument: "INDEX", needs_holding: true }),
      item({ id: "stage", instrument: "CERT", from_value: 5000 }),
      item({ id: "plain", instrument: "CASH" }),
    ]);
    const c = ctx();
    expect(stateOf(cfg, [], c, "held").status).toBe("inactive");
    expect(stateOf(cfg, [], c, "stage").status).toBe("inactive");
    expect(stateOf(cfg, [], c, "plain").status).toBe("due");
    const later = ctx({ total: 5000, held: new Set(["CASH", "INDEX"]) });
    expect(stateOf(cfg, [], later, "held").status).toBe("due");
    expect(stateOf(cfg, [], later, "stage").status).toBe("due");
  });

  it("orders by urgency, then by how late", () => {
    const cfg = config([
      item({ id: "ok1", after_days: 100 }),
      item({ id: "due_late", after_days: 0 }),
      item({ id: "due_less", after_days: 5 }),
      item({ id: "prob" }),
      item({ id: "closed", every_days: null }),
    ]);
    const log = [
      row({ item: "prob", date: "2026-12-01", result: "problem", next_due: "2026-12-08" }),
      row({ item: "closed", date: "2026-12-01" }),
    ];
    const order = reviewStates(cfg, log, ctx({ today: "2026-12-20" })).map((s) => s.item.id);
    expect(order).toEqual(["prob", "due_late", "due_less", "ok1", "closed"]);
  });
});

describe("pending", () => {
  it("is what waits on the person: open problems and reviews whose day has come", () => {
    const cfg = config([
      item({ id: "a", title: "فحص أ" }),
      item({ id: "b", title: "فحص ب", after_days: 60 }),
      item({ id: "p", title: "فحص المشكلة" }),
    ]);
    const log = [row({ item: "p", date: "2026-11-28", result: "problem", note: "الرسوم أعلى", next_due: "2026-12-05" })];
    const states = reviewStates(cfg, log, ctx({ today: "2026-11-29" }));
    expect(pending(states).map((s) => s.item.id)).toEqual(["p", "a"]);
    expect(pending(reviewStates(config([item({ id: "a", after_days: 60 })]), [], ctx()))).toEqual([]);
  });
});

describe("validateConfig", () => {
  const known = new Set(["CASH", "GOLD"]);
  it("accepts a sound list", () => {
    expect(validateConfig(config([item({ id: "a" }), item({ id: "b", instrument: null })]), known)).toEqual([]);
  });
  it("names every kind of slip", () => {
    const bad = config([
      item({ id: "a" }),
      item({ id: "a" }),
      item({ id: "Bad Id" }),
      item({ id: "x", instrument: "NOPE" }),
      item({ id: "y", every_days: 0 }),
      item({ id: "z", checks: [] }),
      item({ id: "w", instrument: null, needs_holding: true }),
    ]);
    expect(validateConfig(bad, known)).toHaveLength(6);
  });
});

describe("the shipped review list", () => {
  it("is well formed and only names instruments the portfolio knows", async () => {
    const reviews = (await import("../config/reviews.json")).default as unknown as ReviewsConfig;
    const portfolio = (await import("../config/portfolio.json")).default as { instruments: Record<string, unknown> };
    expect(validateConfig(reviews, new Set(Object.keys(portfolio.instruments)))).toEqual([]);
    expect(reviews.items.length).toBeGreaterThan(10);
    // what is due the day tracking starts is the open to-do list; nothing about a later stage or an unheld asset
    const states = reviewStates(reviews, [], { today: reviews.start, total: 2000, held: new Set(["CASH"]) });
    const due = states.filter((s) => s.status === "due").map((s) => s.item.id);
    expect(due).toEqual(expect.arrayContaining(["cash_agency_bank", "gold_custody", "equity_mixed_ruling"]));
    expect(due).not.toContain("equity_purification");
    expect(due).not.toContain("safe_contract");
    expect(states.find((s) => s.item.id === "plan_semiannual")!.due).toBe("2027-05-17");
  });
});
