"use client";

import { useState } from "react";
import { Bitcoin, CalendarClock, Landmark, LogOut, Settings, Smartphone } from "lucide-react";
import { formatDate, pct } from "@/lib/format";
import { usePortfolio } from "@/state/portfolio-provider";
import { Badge, Bubble, Button, Card, CardHead, Field, Input, Notice, PageHead, Switch } from "@/ui";
import { D, N } from "@/ui/text";

export function SettingsScreen() {
  const app = usePortfolio();
  const data = app.data!;
  const { config } = data;
  const [monthly, setMonthly] = useState(String(config.monthly_contribution));
  const [rate, setRate] = useState(String(Number(((config.macro.cbe_deposit_rate ?? 0) * 100).toFixed(2))));
  const [inflation, setInflation] = useState(String(Number(((config.macro.inflation_urban ?? 0) * 100).toFixed(2))));
  const [busy, setBusy] = useState(false);
  const crypto = config.crypto;

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

        <Card tone={crypto?.enabled ? "lilac" : undefined} className="span-6">
          <CardHead
            title="خانة الكريبتو"
            hint="متوقفة افتراضيًا. تفعيلها بيدخل بيتكوين Spot في خطة الشراء"
            actions={
              <>
                <Badge tone={crypto?.enabled ? "ink" : "outline"}>{crypto?.enabled ? "مفعّلة" : "متوقفة"}</Badge>
                <Switch checked={Boolean(crypto?.enabled)} onChange={(checked) => void save({ crypto_enabled: checked })} label="تفعيل خانة الكريبتو" />
              </>
            }
          />
          <div className="kv">
            <div>
              <b>
                <N>{`${crypto?.target_pct ?? 0}%`}</N>
              </b>
              <span>النسبة المستهدفة</span>
            </div>
            <div>
              <b>
                <N>{(crypto?.from_value ?? 0).toLocaleString("en-US")}</N>
              </b>
              <span>تبدأ من قيمة محفظة (جنيه)</span>
            </div>
            <div>
              <b>
                <N>{(config.buckets.crypto?.min_order ?? 0).toLocaleString("en-US")}</N>
              </b>
              <span>أقل أمر شراء (جنيه)</span>
            </div>
          </div>
          <Notice icon={<Bitcoin />}>
            Spot فقط، من غير رافعة ولا عقود ولا Earn. قاعدة الخروج: إقفال تحت متوسط 200 يوم 5 أيام متتالية. تداول الكريبتو في مصر من غير ترخيص له مخاطر قانونية، والحكم الشرعي فيه خلاف.
          </Notice>
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
