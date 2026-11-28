"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { keyBytes } from "@/lib/push";
import { usePortfolio } from "@/state/portfolio-provider";
import { Badge, Bubble, Button, Card, CardHead, Notice } from "@/ui";

/** What this device and the server can do about phone notifications right now. */
type Phase =
  | { name: "loading" }
  | { name: "unsupported" }
  | { name: "unconfigured" }
  | { name: "denied" }
  | { name: "off"; key: string }
  | { name: "on"; key: string; endpoint: string };

/** The registered service worker, or null when there is none (it is only registered in the production build). */
async function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))]);
}

export function PushCard() {
  const app = usePortfolio();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window) || !("PushManager" in window)) {
      setPhase({ name: "unsupported" });
      return;
    }
    try {
      const response = await fetch("/api/push", { cache: "no-store", credentials: "same-origin" });
      const info = (await response.json().catch(() => null)) as { configured?: boolean; public_key?: string | null } | null;
      if (!response.ok || !info) {
        setPhase({ name: "unconfigured" });
        return;
      }
      if (!info.configured || !info.public_key) {
        setPhase({ name: "unconfigured" });
        return;
      }
      if (Notification.permission === "denied") {
        setPhase({ name: "denied" });
        return;
      }
      const registration = await worker();
      if (!registration) {
        setPhase({ name: "unsupported" });
        return;
      }
      const subscription = await registration.pushManager.getSubscription();
      setPhase(subscription ? { name: "on", key: info.public_key, endpoint: subscription.endpoint } : { name: "off", key: info.public_key });
    } catch {
      setPhase({ name: "unsupported" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async (key: string) => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        app.notify("ماوافقتش على الإشعارات. تقدر تفعّلها من إعدادات المتصفح للموقع.");
        return;
      }
      const registration = await worker();
      if (!registration) {
        app.notify("الإشعارات بتشتغل من التطبيق المنشور بس.");
        return;
      }
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      const done = await app.send("POST", "/api/push", { op: "subscribe", subscription: subscription.toJSON() });
      // A subscription the server did not accept would be a dead one: drop it so the next try starts clean.
      if (!done) await subscription.unsubscribe();
    } catch {
      app.notify("تعذر تفعيل الإشعارات على الجهاز ده.");
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const disable = async (endpoint: string) => {
    setBusy(true);
    try {
      const registration = await worker();
      const subscription = await registration?.pushManager.getSubscription();
      const done = await app.send("POST", "/api/push", { op: "unsubscribe", endpoint });
      if (done) await subscription?.unsubscribe();
    } catch {
      app.notify("تعذر إيقاف الإشعارات.");
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await app.send("POST", "/api/push", { op: "test" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="span-6">
      <CardHead
        title="إشعارات المراجعات"
        hint="تنبيه على الموبايل لما بند مراجعة ميعاده يجي"
        actions={
          <>
            {phase.name === "on" ? <Badge tone="mint">شغّالة</Badge> : null}
            <Bubble>{phase.name === "on" ? <BellRing /> : phase.name === "off" || phase.name === "loading" ? <Bell /> : <BellOff />}</Bubble>
          </>
        }
      />
      <p className="t-small t-label">
        بيوصلك إشعار مرة في اليوم الصبح لو فيه حاجة جديدة مستنياك (بند ميعاده جه أو مشكلة اتسجّلت)، وتذكير كل 3 أيام لو لسه مستنية. الإشعار بيفتح شاشة المتابعة.
      </p>

      {phase.name === "unsupported" ? (
        <Notice block>
          الجهاز ده أو المتصفح مش بيدعم الإشعارات هنا. على iPhone لازم تثبّت التطبيق على الشاشة الرئيسية الأول (iOS 16.4 أو أحدث) وتفتحه منها، وبعدها فعّلها من هنا.
        </Notice>
      ) : null}
      {phase.name === "unconfigured" ? (
        <Notice block>
          <div className="stack stack--sm">
            <span>الخادم لسه مش مجهّز للإشعارات. أضف المتغيرات دي في إعدادات Vercel وأعد النشر:</span>
            <span>
              <bdi dir="ltr">VAPID_PUBLIC_KEY</bdi> · <bdi dir="ltr">VAPID_PRIVATE_KEY</bdi> · <bdi dir="ltr">VAPID_SUBJECT</bdi>
            </span>
            <span>
              بتتولّد بالأمر <bdi dir="ltr">npm run vapid</bdi>
            </span>
          </div>
        </Notice>
      ) : null}
      {phase.name === "denied" ? <Notice block>الإشعارات متقفولة للموقع ده من إعدادات المتصفح. افتحها من هناك وارجع هنا.</Notice> : null}

      <div className="card__grow" />
      <div className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        {phase.name === "off" ? (
          <Button variant="ink" icon={<BellRing />} disabled={busy} onClick={() => void enable(phase.key)}>
            {busy ? "جاري التفعيل…" : "فعّل الإشعارات على الجهاز ده"}
          </Button>
        ) : null}
        {phase.name === "on" ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => void disable(phase.endpoint)}>
              وقّف الإشعارات
            </Button>
            <Button variant="soft" disabled={busy} onClick={() => void test()}>
              جرّب إشعار
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  );
}
