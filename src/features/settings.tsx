"use client";

import { useState } from "react";
import { Bitcoin, CalendarClock, Landmark, LogOut, Settings, Smartphone } from "lucide-react";
import { formatDate, pct } from "@/lib/format";
import { usePortfolio } from "@/state/portfolio-provider";
import { Badge, Bubble, Button, Card, CardHead, Field, Input, Notice, PageHead } from "@/ui";
import { D, N } from "@/ui/text";

export function SettingsScreen() {
  const app = usePortfolio();
  const data = app.data!;
  const { config } = data;
  const [monthly, setMonthly] = useState(String(config.monthly_contribution));
  const [rate, setRate] = useState(String(Number(((config.macro.cbe_deposit_rate ?? 0) * 100).toFixed(2))));
  const [inflation, setInflation] = useState(String(Number(((config.macro.inflation_urban ?? 0) * 100).toFixed(2))));
  const [busy, setBusy] = useState(false);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    await app.send("PUT", "/api/settings", body);
    setBusy(false);
  };

  return (
    <>
      <PageHead
        eyebrow={
          <>
            <Settings /> النظام
          </>
        }
        title="الإعدادات"
        subtitle="الحاجات اللي بتتغير مع الوقت. نسب التوزيع والمراحل نفسها ثابتة في ملف الخطة داخل الكود."
      />

      <div className="bento">
        <Card className="span-6">
          <CardHead title="الإضافة الشهرية" hint="المبلغ اللي خطة الشراء بتفترضه لما مايكونش فيه رصيد مستني التوزيع" actions={<Bubble><CalendarClock /></Bubble>} />
          <div className="row row--wrap" style={{ alignItems: "flex-end" }}>
            <Field label="المبلغ بالجنيه" className="grow">
              <Input type="number" inputMode="decimal" dir="ltr" min="0" step="100" value={monthly} onChange={(event) => setMonthly(event.target.value)} />
            </Field>
            <Button variant="ink" disabled={busy || monthly === "" || Number(monthly) === config.monthly_contribution} onClick={() => void save({ monthly_contribution: Number(monthly) })}>
              حفظ
            </Button>
          </div>
        </Card>

        <Card className="span-6">
          <CardHead
            title="أرقام السوق"
            hint={
              config.macro.as_of ? (
                <>
                  آخر تحديث <D>{formatDate(config.macro.as_of)}</D>. بيطلع تنبيه لو عدّى عليها <N>45</N> يوم.
                </>
              ) : (
                "لسه ما اتسجلتش"
              )
            }
            actions={<Bubble><Landmark /></Bubble>}
          />
          <div className="form-grid">
            <Field label="سعر عائد الإيداع (البنك المركزي) %">
              <Input type="number" inputMode="decimal" dir="ltr" min="0" max="100" step="0.25" value={rate} onChange={(event) => setRate(event.target.value)} />
            </Field>
            <Field label="التضخم السنوي للحضر %">
              <Input type="number" inputMode="decimal" dir="ltr" min="-50" max="500" step="0.1" value={inflation} onChange={(event) => setInflation(event.target.value)} />
            </Field>
            <div className="full row row--between row--wrap">
              <span className="t-small t-muted">
                العائد الحقيقي التقريبي: <N>{pct((Number(rate) - Number(inflation)) / 100)}</N>
              </span>
              <Button variant="ink" disabled={busy || rate === "" || inflation === ""} onClick={() => void save({ cbe_deposit_rate: Number(rate) / 100, inflation_urban: Number(inflation) / 100 })}>
                حفظ الأرقام
              </Button>
            </div>
          </div>
        </Card>

        <Card className="span-6">
          <CardHead title="الكريبتو" hint="شريحة مستقلة عن المحفظة، ومقفولة" actions={<Badge tone="outline">خارج المحفظة</Badge>} />
          <p className="t-small t-label">
            الكريبتو خرج من الإضافة الشهرية للمحفظة، وبقى له مخصص منفصل بسياسة مكتوبة في الخطة. مفيش شراء حقيقي دلوقتي: القواعد بتتجرب الأول على دفاتر تجريبية بإيداع افتراضي.
          </p>
          <Notice icon={<Bitcoin />}>
            Spot فقط لو اتفتحت، من غير رافعة ولا عقود ولا Earn، وكل عملية بموافقتك. تداول الكريبتو في مصر من غير ترخيص له مخاطر قانونية، والحكم الشرعي فيه خلاف.
          </Notice>
          <Button variant="soft" href="/lab" arrow>
            افتح الدفاتر التجريبية
          </Button>
        </Card>

        <Card className="span-6">
          <CardHead title="التطبيق" hint="تثبيت على الموبايل وتسجيل الخروج" actions={<Bubble><Smartphone /></Bubble>} />
          <p className="t-small t-label">
            للتثبيت: افتح الموقع من متصفح الموبايل، ثم «إضافة إلى الشاشة الرئيسية» (Chrome: القائمة ⋮، Safari: زر المشاركة). هيفتح بعد كده كتطبيق مستقل.
          </p>
          <p className="t-small t-label">
            الدفتر التجريبي والحقيقي منفصلين تمامًا في العمليات والأسعار. الأسعار المرجعية مشتركة بينهم.
          </p>
          <div className="card__grow" />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" icon={<LogOut className="flip" />} onClick={() => void app.signOut()}>
              تسجيل الخروج
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
