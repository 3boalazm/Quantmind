/** Browser push subscriptions: checking what a browser sends us, and sending one message to every device. Pure. */

/** The push services the big browsers use. A subscription pointing anywhere else is refused. */
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** The shape `PushSubscription.toJSON()` gives, or null when anything is off. */
export function parseSubscription(value: unknown): PushSubscriptionInput | null {
  if (typeof value !== "object" || value === null) return null;
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!isPushEndpoint(endpoint) || typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys;
  const key = /^[A-Za-z0-9_-]{10,200}={0,2}$/;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !key.test(p256dh) || !key.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface DeliveryReport {
  sent: number;
  /** Endpoints the push service says no longer exist: to be forgotten. */
  gone: string[];
  failed: number;
}

/** Sends to every device at once; one device failing never stops the rest. */
export async function deliver(
  devices: PushSubscriptionInput[],
  payload: PushPayload,
  send: (device: PushSubscriptionInput, body: string) => Promise<unknown>,
): Promise<DeliveryReport> {
  const body = JSON.stringify(payload);
  const outcomes = await Promise.all(
    devices.map((device) =>
      send(device, body).then(
        () => "sent" as const,
        (error: unknown) => {
          const status = (error as { statusCode?: number }).statusCode;
          return status === 404 || status === 410 ? ("gone" as const) : ("failed" as const);
        },
      ),
    ),
  );
  return {
    sent: outcomes.filter((o) => o === "sent").length,
    gone: devices.filter((_, i) => outcomes[i] === "gone").map((d) => d.endpoint),
    failed: outcomes.filter((o) => o === "failed").length,
  };
}

/** A VAPID public key as the bytes `pushManager.subscribe` wants (URL-safe base64 in, 65-byte point out). */
export function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
