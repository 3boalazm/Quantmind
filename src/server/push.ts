import "server-only";
import { sendNotification, setVapidDetails } from "web-push";
import { reviewNotice, type NoticeMemory } from "@/lib/review-notice";
import { deliver, type DeliveryReport, type PushPayload, type PushSubscriptionInput } from "@/lib/push";
import { today } from "./config";
import { readSetting, writeSetting, type Queryable } from "./db";
import { loadReviews } from "./reviews";

const MEMORY_KEY = "review_push";
/** One person, a few devices. */
export const MAX_DEVICES = 10;

interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The three values that switch push on; all must be set in the environment. */
export function vapid(): Vapid | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export async function listDevices(q: Queryable): Promise<PushSubscriptionInput[]> {
  const { rows } = await q.query<PushSubscriptionInput>("SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at");
  return rows;
}

export async function saveDevice(q: Queryable, device: PushSubscriptionInput): Promise<void> {
  await q.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [device.endpoint, device.p256dh, device.auth],
  );
}

export async function forgetDevices(q: Queryable, endpoints: string[]): Promise<void> {
  if (endpoints.length) await q.query("DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])", [endpoints]);
}

/** Sends one message to every saved device and forgets the ones the push service says are gone. */
export async function sendToDevices(q: Queryable, payload: PushPayload): Promise<DeliveryReport | null> {
  const keys = vapid();
  if (!keys) return null;
  setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  const report = await deliver(await listDevices(q), payload, (device, body) =>
    sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, body, { TTL: 60 * 60 * 24, timeout: 10_000 }),
  );
  await forgetDevices(q, report.gone);
  return report;
}

export type ReviewPushResult =
  | { status: "not_configured" }
  | { status: "nothing_new" }
  | { status: "no_devices" }
  | { status: "sent"; report: DeliveryReport };

/**
 * The daily check: tells the phone what waits on a review, if there is something new or it has waited a while.
 * What was said last time is remembered, so the same list does not come every day.
 */
export async function pushReviewNotice(q: Queryable): Promise<ReviewPushResult> {
  if (!vapid()) return { status: "not_configured" };
  const day = today();
  const view = await loadReviews(q);
  const memory = await readSetting<NoticeMemory>(q, MEMORY_KEY);
  const notice = reviewNotice(view.states, memory, day);
  if (!notice) return { status: "nothing_new" };
  if ((await listDevices(q)).length === 0) return { status: "no_devices" };
  const report = await sendToDevices(q, { title: notice.title, body: notice.body, url: notice.url, tag: "qm-reviews" });
  if (!report) return { status: "not_configured" };
  // Only a message that reached a device is remembered, so a failed night is tried again the next one.
  if (report.sent > 0) await writeSetting(q, MEMORY_KEY, { at: day, keys: notice.keys } satisfies NoticeMemory);
  return { status: "sent", report };
}
