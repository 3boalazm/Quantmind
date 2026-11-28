import { describe, expect, it } from "vitest";
import { deliver, isPushEndpoint, keyBytes, parseSubscription } from "../src/lib/push";
import { reviewNotice, waitKey, REMIND_AFTER_DAYS } from "../src/lib/review-notice";
import { reviewStates, type ReviewItem, type ReviewLog, type ReviewsConfig } from "../src/lib/followup";

const item = (over: Partial<ReviewItem> & { id: string }): ReviewItem => ({ instrument: null, title: `بند ${over.id}`, checks: ["x"], every_days: null, ...over });
const config = (items: ReviewItem[]): ReviewsConfig => ({ start: "2026-11-28", soon_days: 7, items });
const ctx = (today: string) => ({ today, total: 10_000, held: new Set<string>() });
const log = (over: Partial<ReviewLog> & { item: string }): ReviewLog => ({ id: 1, date: "2026-11-28", result: "ok", note: "", next_due: null, ...over });

describe("push endpoints", () => {
  it("accepts the browsers' own push services only", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("https://db3p.notify.windows.com/?token=abc")).toBe(true);
  });
  it("refuses anything else: plain http, other hosts, look-alikes, credentials, junk", () => {
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://example.com/push")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
    expect(isPushEndpoint("https://evilfcm.googleapis.com@127.0.0.1/x")).toBe(false);
    expect(isPushEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
    expect(isPushEndpoint(42)).toBe(false);
    expect(isPushEndpoint(`https://fcm.googleapis.com/${"a".repeat(1000)}`)).toBe(false);
  });
});

describe("parseSubscription", () => {
  const good = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };
  it("reads what PushSubscription.toJSON() gives", () => {
    expect(parseSubscription(good)).toEqual({ endpoint: good.endpoint, p256dh: good.keys.p256dh, auth: good.keys.auth });
  });
  it("rejects missing or malformed parts", () => {
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription({ endpoint: good.endpoint })).toBeNull();
    expect(parseSubscription({ ...good, keys: { ...good.keys, auth: "short" } })).toBeNull();
    expect(parseSubscription({ ...good, keys: { ...good.keys, p256dh: "has spaces and !" } })).toBeNull();
    expect(parseSubscription({ ...good, endpoint: "https://example.com/x" })).toBeNull();
  });
});

describe("deliver", () => {
  const devices = ["a", "b", "c", "d"].map((id) => ({ endpoint: `https://fcm.googleapis.com/${id}`, p256dh: "p", auth: "a" }));
  const payload = { title: "t", body: "b", url: "/follow-up", tag: "qm" };
  it("counts sent, forgets gone devices, and keeps going after a failure", async () => {
    const send = async (device: { endpoint: string }) => {
      if (device.endpoint.endsWith("/b")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (device.endpoint.endsWith("/c")) throw Object.assign(new Error("busy"), { statusCode: 503 });
      if (device.endpoint.endsWith("/d")) throw new Error("network");
    };
    expect(await deliver(devices, payload, send)).toEqual({ sent: 1, gone: ["https://fcm.googleapis.com/b"], failed: 2 });
  });
  it("sends the payload as JSON", async () => {
    let seen = "";
    await deliver(devices.slice(0, 1), payload, async (_device, body) => {
      seen = body;
    });
    expect(JSON.parse(seen)).toEqual(payload);
  });
});

describe("reviewNotice", () => {
  const cfg = config([item({ id: "a" }), item({ id: "b" }), item({ id: "c" }), item({ id: "later", after_days: 60 })]);
  const states = reviewStates(cfg, [], ctx("2026-11-28"));

  it("says nothing when nothing waits", () => {
    expect(reviewNotice(reviewStates(config([item({ id: "z", after_days: 60 })]), [], ctx("2026-11-28")), null, "2026-11-28")).toBeNull();
  });
  it("speaks the first time, naming two and counting the rest", () => {
    const n = reviewNotice(states, null, "2026-11-28")!;
    expect(n.body).toContain("3 مراجعة مستحقة");
    expect(n.body).toContain("«بند a»");
    expect(n.body).toContain("و1 كمان");
    expect(n.url).toBe("/follow-up");
    expect(n.keys).toHaveLength(3);
  });
  it("stays quiet about the same list the next day, reminds after a few days", () => {
    const first = reviewNotice(states, null, "2026-11-28")!;
    const memory = { at: "2026-11-28", keys: first.keys };
    expect(reviewNotice(states, memory, "2026-11-29")).toBeNull();
    expect(reviewNotice(states, memory, "2026-11-30")).toBeNull();
    expect(reviewNotice(states, { at: "2026-11-28", keys: first.keys }, `2026-12-0${1 + REMIND_AFTER_DAYS - 3}`)).not.toBeNull();
  });
  it("speaks again at once when something new comes due", () => {
    const first = reviewNotice(states, null, "2026-11-28")!;
    const later = config([...cfg.items, item({ id: "d", after_days: 2 })]);
    const next = reviewNotice(reviewStates(later, [], ctx("2026-11-30")), { at: "2026-11-28", keys: first.keys }, "2026-11-30")!;
    expect(next).not.toBeNull();
    expect(next.keys.some((k) => k.startsWith("d:"))).toBe(true);
  });
  it("puts an open problem in the words, and a new problem is a new wait", () => {
    const withProblem = reviewStates(cfg, [log({ id: 7, item: "a", result: "problem", note: "x", next_due: "2026-12-05" })], ctx("2026-11-29"));
    const n = reviewNotice(withProblem, null, "2026-11-29")!;
    expect(n.body).toContain("1 مشكلة مفتوحة و2 مراجعة مستحقة");
    expect(waitKey(withProblem.find((s) => s.item.id === "a")!)).toBe("a:problem:7");
  });
  it("a reviewed item leaves the list, and an emptied list sends nothing", () => {
    const done = reviewStates(cfg, ["a", "b", "c"].map((id, i) => log({ id: i + 1, item: id })), ctx("2026-11-29"));
    expect(reviewNotice(done, { at: "2026-11-28", keys: ["a:2026-11-28"] }, "2026-11-29")).toBeNull();
  });
});

describe("keyBytes", () => {
  it("turns a VAPID public key into the 65-byte uncompressed point the browser needs", () => {
    const bytes = keyBytes("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM");
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
});
