import { OpError } from "@/lib/ops";
import { parseSubscription, isPushEndpoint } from "@/lib/push";
import { body, guard, handle, HttpError, ok } from "@/server/api";
import { db } from "@/server/db";
import { forgetDevices, listDevices, MAX_DEVICES, saveDevice, sendToDevices, vapid } from "@/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Phone notifications: whether the server can send them, and which devices to send to. */
export async function GET(request: Request) {
  return handle(async () => {
    await guard(request);
    const keys = vapid();
    return ok({ configured: keys !== null, public_key: keys?.publicKey ?? null, devices: (await listDevices(await db())).length });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    await guard(request, true);
    const data = await body(request);
    const q = await db();

    switch (data.op) {
      case "subscribe": {
        if (!vapid()) throw new OpError("الإشعارات مش متظبطة على الخادم لسه (مفاتيح VAPID).");
        const device = parseSubscription(data.subscription);
        if (!device) throw new HttpError(400, "بيانات اشتراك الجهاز مش سليمة.");
        const known = await listDevices(q);
        if (!known.some((d) => d.endpoint === device.endpoint) && known.length >= MAX_DEVICES) {
          throw new OpError(`وصلت لحد ${MAX_DEVICES} أجهزة. وقّف الإشعارات على جهاز قديم الأول.`);
        }
        await saveDevice(q, device);
        return ok({ ok: true, message: "الإشعارات اشتغلت على الجهاز ده." });
      }
      case "unsubscribe": {
        if (!isPushEndpoint(data.endpoint)) throw new HttpError(400, "عنوان الاشتراك مش سليم.");
        await forgetDevices(q, [data.endpoint]);
        return ok({ ok: true, message: "الإشعارات وقفت على الجهاز ده." });
      }
      case "test": {
        if (!vapid()) throw new OpError("الإشعارات مش متظبطة على الخادم لسه (مفاتيح VAPID).");
        const report = await sendToDevices(q, { title: "QuantMind", body: "ده إشعار تجريبي. لو وصلك يبقى الإشعارات شغالة.", url: "/follow-up", tag: "qm-test" });
        if (!report || report.sent === 0) throw new OpError("مفيش جهاز استلم الإشعار. فعّل الإشعارات على الجهاز الأول وجرّب تاني.");
        return ok({ ok: true, message: `اتبعت الإشعار لـ ${report.sent} جهاز.` });
      }
      default:
        throw new HttpError(400, "نوع العملية غير معروف.");
    }
  });
}
