"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, FlaskConical, Landmark, RefreshCw, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import type { BookId, Decision, LabConfig, LabResult } from "@/lib/lab";
import { egp, egp2, formatDate, pct, signedEgp, signedPct } from "@/lib/format";
import { usePortfolio } from "@/state/portfolio-provider";
import { Badge, Button, Card, CardHead, Empty, Notice, PageHead, StatCard, cx } from "@/ui";
import { D, N } from "@/ui/text";

interface LabView extends LabResult {
  config: LabConfig;
  today: string;
}

const BOOKS: Record<BookId, { name: string; rule: (c: LabConfig) => string }> = {
  A: { name: "شراء شهري ثابت", rule: () => "بيشتري بإيداع الشهر كله يوم الإيداع، من غير أي شرط. ده خط الأساس اللي الباقي بيتقارن بيه." },
  B: {
    name: "شراء مع الاتجاه",
    rule: (c) => `بيشتري بكل السيولة المنتظرة لو الإغلاق فوق متوسط ${c.sma_days} يوم والمتوسط أعلى من قيمته من ${c.slope_days} يوم. غير كده السيولة تستنى. مابيبيعش.`,
  },
  B2: { name: "مع الاتجاه + خروج", rule: (c) => `زي B، وبيبيع كل اللي معاه لو الإغلاق فضل تحت المتوسط ${c.exit_days} أيام ورا بعض. ده القاعدة المكتوبة في الخطة.` },
  C: { name: "اتجاه + تقلب هادي", rule: (c) => `شرطين B، ومعاهم إن تقلب آخر ${c.vol_days} يوم مايزيدش عن ${Math.round(c.vol_max * 100)}% سنويًا. مابيبيعش.` },
  D: {
    name: "تحويل التدفقات",
    rule: (c) =>
      `بيشتري زي A. لو البيتكوين اتأخر عن صندوق النقد بـ ${Math.round(c.switch.lag_gap * 100)} نقط أو أكتر على ${c.switch.lag_days} يوم في فحصين شهريين ورا بعض، الإيداع الجديد يروح الصندوق. بيرجع لما يسبق الصندوق بـ ${Math.round(c.switch.back_gap * 100)} نقط على ${c.switch.back_days} يوم والاتجاه طالع، في فحصين. مابيبيعش.`,
  },
};

const REASON: Record<Decision["reason"], string> = {
  schedule: "شراء دوري من غير شروط",
  trend_ok: "الاتجاه طالع",
  trend_down: "الإغلاق تحت المتوسط أو المتوسط نازل",
  no_data: "البيانات ناقصة للحساب",
  vol_ok: "الاتجاه طالع والتقلب تحت الحد",
  vol_high: "التقلب فوق الحد",
  exit_rule: "الإغلاق تحت المتوسط كذا يوم ورا بعض",
  state_crypto: "البيتكوين مش متأخر عن الصندوق",
  state_fund: "البيتكوين متأخر عن الصندوق: الإيداع راح الصندوق",
};

const KIND: Record<Decision["kind"], { label: string; tone: "mint" | "outline" | "peach" | "sand" }> = {
  buy: { label: "شراء", tone: "mint" },
  wait: { label: "انتظار", tone: "outline" },
  sell: { label: "بيع", tone: "peach" },
  to_fund: { label: "للصندوق", tone: "sand" },
};

export function LabScreen() {
  const app = usePortfolio();
  const [data, setData] = useState<LabView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const response = await fetch("/api/lab", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const payload = await response.json().catch(() => null);
      if (id !== request.current) return;
      if (!response.ok) {
        setError(payload?.error ?? "تعذر تحميل الدفاتر.");
        return;
      }
      setData(payload as LabView);
      setError(null);
    } catch {
      if (id === request.current) setError("مفيش اتصال بالخادم. اتأكد من الإنترنت وجرّب تاني.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await app.send("POST", "/api/lab", { op: "sync" }, load);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        eyebrow={
          <>
            <FlaskConical /> تجربة من غير فلوس حقيقية
          </>
        }
        title="دفاتر الكريبتو التجريبية"
        subtitle="خمس طرق لشراء البيتكوين بنفس الإيداع الافتراضي، علشان نعرف أيها يستاهل قبل أي جنيه حقيقي."
        actions={
          <Button variant="soft" icon={<RefreshCw className={busy ? "spin" : undefined} />} disabled={busy} onClick={() => void sync()}>
            {busy ? "جاري التحديث…" : "تحديث البيانات"}
          </Button>
        }
      />
      {error && !data ? (
        <Card>
          <Empty
            icon={<TriangleAlert />}
            title="تعذر تحميل الدفاتر"
            description={error}
            action={
              <Button variant="ink" onClick={() => void load()}>
                حاول تاني
              </Button>
            }
          />
        </Card>
      ) : !data ? (
        <div className="bento" aria-busy="true" aria-label="جاري التحميل">
          <div className="card card--soft skeleton span-12" style={{ minHeight: 220 }} />
        </div>
      ) : (
        <Lab data={data} />
      )}
    </>
  );
}

function Lab({ data }: { data: LabView }) {
  const c = data.config;
  const s = data.signals;
  const started = data.asof !== null;
  const best = started ? [...data.books].sort((a, b) => b.value - a.value)[0] : null;
  const enoughHistory = data.data.btc_days >= c.sma_days + c.slope_days;

  return (
    <div className="bento">
      <div className="span-12">
        <Notice icon={<FlaskConical />}>
          مفيش شراء حقيقي ولا اتصال بأي منصة. القواعد اتسجلت يوم <D>{formatDate(c.start)}</D> (الإصدار <N>{c.version}</N>) قبل ما أسعارها تتعرف، ومابتتغيرش جوه الإصدار. الأرقام هنا مش
          توقع ولا توصية.
        </Notice>
      </div>

      <StatCard
        className="span-3"
        label="اتدفع افتراضيًا"
        value={<N>{egp(data.paid)}</N>}
        unit="جنيه"
        icon={<Landmark />}
        hint={
          <>
            <N>{egp(c.deposit)}</N> يوم <N>{c.day}</N> من كل شهر
          </>
        }
      />
      <StatCard
        className="span-3"
        label="لو راحت صندوق النقد"
        value={<N>{egp(data.shadow)}</N>}
        unit="جنيه"
        icon={<Landmark />}
        hint={
          <>
            بعائد مفترض <N>{pct(c.cash_yield, 0)}</N> سنويًا
          </>
        }
      />
      <StatCard
        className="span-3"
        tone={best && best.vs_shadow > 0.5 ? "mint" : undefined}
        label="أعلى دفتر دلوقتي"
        value={best ? <N>{egp(best.value)}</N> : "—"}
        unit={best ? "جنيه" : undefined}
        icon={<Activity />}
        hint={best ? `${best.id} · ${BOOKS[best.id].name}` : "لسه مفيش إيداع محسوب"}
      />
      <StatCard
        className="span-3"
        label="محسوب لحد"
        value={started ? <D>{formatDate(data.asof as string, { day: "numeric", month: "short" })}</D> : "—"}
        icon={<RefreshCw />}
        hint={
          <>
            الإيداع الجاي <D>{formatDate(data.next_deposit, { day: "numeric", month: "short" })}</D>
          </>
        }
      />

      {!started ? (
        <div className="span-12">
          <Card>
            <Empty
              icon={<FlaskConical />}
              title="أول إيداع افتراضي لسه ماتحسبش"
              description={`الدفاتر بتشتغل على إغلاق اليوم بتوقيت UTC. إيداع ${formatDate(data.next_deposit)} هيظهر بعد ما اليوم يقفل والبيانات تتحدّث (التحديث اليومي الصبح، أو زر «تحديث البيانات»).`}
            />
          </Card>
        </div>
      ) : (
        <Card className="span-12">
          <CardHead title="المقارنة" hint="كل الدفاتر بنفس الإيداع ونفس التواريخ. الفرق عن صندوق النقد هو المعيار الحاسم في السياسة." />
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>الدفتر</th>
                  <th className="num-col">الرصيد</th>
                  <th className="num-col">الفرق عن الصندوق</th>
                  <th className="num-col">العائد السنوي</th>
                  <th className="num-col">قيمة الوحدة</th>
                  <th className="num-col">أقصى هبوط</th>
                  <th className="num-col">سيولة منتظرة</th>
                </tr>
              </thead>
              <tbody>
                {data.books.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <b>
                        {b.id} · {BOOKS[b.id].name}
                      </b>
                      <span className="sub">
                        بيتكوين <N>{egp(b.btc_value)}</N> · شهور من غير شراء <N>{b.idle_months}</N>
                      </span>
                    </td>
                    <td data-label="الرصيد" className="num-col">
                      <N>{egp2(b.value)}</N>
                    </td>
                    <td data-label="الفرق عن الصندوق" className={cx("num-col", b.vs_shadow > 0.5 && "t-ok", b.vs_shadow < -0.5 && "t-bad")}>
                      <N>{signedEgp(b.vs_shadow)}</N>
                    </td>
                    <td data-label="العائد السنوي" className="num-col">
                      <N>{b.xirr === null ? "—" : signedPct(b.xirr, 1)}</N>
                    </td>
                    <td data-label="قيمة الوحدة" className="num-col">
                      <N>{b.nav.toFixed(3)}</N>
                    </td>
                    <td data-label="أقصى هبوط" className="num-col">
                      <N>{pct(b.max_drawdown, 1)}</N>
                      {b.btc_drawdown !== null ? (
                        <span className="sub">
                          البيتكوين <N>{pct(b.btc_drawdown, 1)}</N>
                        </span>
                      ) : null}
                    </td>
                    <td data-label="سيولة منتظرة" className="num-col">
                      <N>{pct(b.cash_share, 0)}</N>
                    </td>
                  </tr>
                ))}
                <tr className="row--total">
                  <td>المحفظة الظل (صندوق النقد)</td>
                  <td data-label="الرصيد" className="num-col">
                    <N>{egp2(data.shadow)}</N>
                  </td>
                                    <td className="num-col lab-gap" aria-hidden="true" />
                  <td data-label="العائد المفترض" className="num-col">
                    <N>{signedPct(c.cash_yield, 1)}</N>
                  </td>
                  <td className="num-col lab-gap" colSpan={3} aria-hidden="true" />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="t-small t-muted">
            العائد السنوي بيظهر بعد شهر على الأقل. أقصى هبوط بيتقاس على قيمة الوحدة، فالإيداع الجديد مابيخبيش النزول. بيانات قليلة زي دي تنفع نستبعد بيها طريقة ضعيفة، ماتنفعش نثبت
            بيها ربحية.
          </p>
        </Card>
      )}

      <Card className="span-5">
        <CardHead
          title="الإشارات دلوقتي"
          hint={
            s ? (
              <>
                من إغلاق <D>{formatDate(s.date)}</D>
              </>
            ) : (
              "مفيش أسعار إغلاق لسه"
            )
          }
        />
        {!s ? (
          <Empty icon={<Activity />} title="مفيش بيانات" description="اضغط «تحديث البيانات» علشان تتسحب أسعار الإغلاق اليومية وسعر الصرف." />
        ) : (
          <>
            <div className="kv">
              <div>
                <b>
                  <N>{`$${Math.round(s.close_usd).toLocaleString("en-US")}`}</N>
                </b>
                <span>إغلاق البيتكوين</span>
              </div>
              <div>
                <b>
                  <N>{s.sma === null ? "—" : `$${Math.round(s.sma).toLocaleString("en-US")}`}</N>
                </b>
                <span>
                  متوسط <N>{c.sma_days}</N> يوم
                </span>
              </div>
              <div>
                <b className={s.above === null ? undefined : s.above >= 0 ? "t-ok" : "t-bad"}>
                  <N>{s.above === null ? "—" : signedPct(s.above, 1)}</N>
                </b>
                <span>السعر عن المتوسط</span>
              </div>
              <div>
                <b>
                  <N>{s.vol === null ? "—" : pct(s.vol, 0)}</N>
                </b>
                <span>
                  تقلب <N>{c.vol_days}</N> يوم (سنوي)
                </span>
              </div>
              <div>
                <b>
                  <N>{s.fx === null ? "—" : s.fx.toFixed(2)}</N>
                </b>
                <span>الدولار بالجنيه</span>
              </div>
            </div>
            <div className="list lab-signals">
              <Signal ok={s.trend_ok} yes="شرط الاتجاه متحقق: الدفاتر B وB2 وC تشتري يوم الإيداع" no="شرط الاتجاه مش متحقق: الدفاتر B وB2 وC تستنى" unknown={`محتاج ${c.sma_days + c.slope_days} إغلاق يومي للحساب`} />
              <Signal
                ok={s.vol === null ? null : s.vol <= c.vol_max}
                yes={`التقلب تحت حد C (${Math.round(c.vol_max * 100)}%)`}
                no={`التقلب فوق حد C (${Math.round(c.vol_max * 100)}%)`}
                unknown="التقلب محتاج بيانات أكتر"
              />
              <Signal ok={s.switch_state === "crypto"} yes="الدفتر D: الإيداع الجاي يدخل بيتكوين" no="الدفتر D: الإيداع الجاي يروح صندوق النقد" unknown="" />
            </div>
            {!enoughHistory ? (
              <Notice>
                الموجود <N>{data.data.btc_days}</N> إغلاق يومي، والمتوسط واتجاهه محتاجين <N>{c.sma_days + c.slope_days}</N>. اضغط «تحديث البيانات».
              </Notice>
            ) : null}
          </>
        )}
      </Card>

      <Card className="span-7">
        <CardHead title="القواعد المسجلة" hint="القرار من إغلاق اليوم اللي قبل الإيداع، والتنفيذ بإغلاق يوم الإيداع." />
        <div className="list">
          {(Object.keys(BOOKS) as BookId[]).map((id) => (
            <div key={id} className="list__row lab-rule">
              <Badge tone="ink">{id}</Badge>
              <div className="list__main">
                <b>{BOOKS[id].name}</b>
                <span>{BOOKS[id].rule(c)}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="t-small t-muted">
          افتراضات لحد ما تتقاس: تكلفة شاملة <N>{pct(c.cost, 0)}</N> على كل شراء أو بيع، وعائد صندوق النقد <N>{pct(c.cash_yield, 0)}</N> سنويًا. الأصل بيتكوين بس، والقياس بالجنيه. سقف
          التعرّض مش مطبّق هنا: ده للفلوس الحقيقية.
        </p>
      </Card>

      {data.checks.length ? (
        <Card className="span-5">
          <CardHead title="فحوص D الشهرية" hint="البيتكوين بالجنيه قصاد صندوق النقد، آخر كل شهر." />
          <div className="list">
            {[...data.checks]
              .reverse()
              .slice(0, 8)
              .map((check) => (
                <div key={check.date} className="list__row">
                  <span className="list__time">
                    <D>{formatDate(check.date, { month: "short", year: "2-digit" })}</D>
                  </span>
                  <div className="list__main">
                    <b>{check.state === "crypto" ? "الإيداع للبيتكوين" : "الإيداع لصندوق النقد"}</b>
                    <span>
                      {check.gap === null ? (
                        "الفحص ماتحسبش: سعر أو سعر صرف ناقص"
                      ) : (
                        <>
                          الفرق على <N>{check.window}</N> يوم
                        </>
                      )}
                    </span>
                  </div>
                  {check.gap !== null ? (
                    <b className={cx("amt", check.gap < 0 ? "amt--neg" : "t-ok")}>
                      <N>{`${signedPct(check.gap, 1)}`}</N>
                    </b>
                  ) : null}
                </div>
              ))}
          </div>
        </Card>
      ) : null}

      <Card className={data.checks.length ? "span-7" : "span-12"}>
        <CardHead title="آخر القرارات" hint="كل قرار بسببه، الأحدث أولًا." />
        {data.decisions.length === 0 ? (
          <Empty icon={<FlaskConical />} title="مفيش قرارات لسه" description="القرارات بتتسجل مع كل يوم إيداع." />
        ) : (
          <div className="list">
            {data.decisions.slice(0, 25).map((d, index) => (
              <div key={`${d.date}-${d.book}-${index}`} className="list__row">
                <span className="list__time">
                  <D>{formatDate(d.date, { day: "numeric", month: "short" })}</D>
                </span>
                <div className="list__main">
                  <b>
                    <Badge tone={KIND[d.kind].tone}>{KIND[d.kind].label}</Badge> {d.book} · {BOOKS[d.book].name}
                  </b>
                  <span>{REASON[d.reason]}</span>
                </div>
                <b className="amt">
                  <N>{egp(d.amount)}</N>
                </b>
              </div>
            ))}
          </div>
        )}
      </Card>

      {data.data.missing.length ? (
        <div className="span-12">
          <Notice>
            فيه <N>{data.data.missing.length}</N> يوم من غير سعر إغلاق أو سعر صرف جوه فترة الحساب، والأرقام اتحمّلت فيهم من اليوم اللي قبله. اضغط «تحديث البيانات».
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

function Signal({ ok, yes, no, unknown }: { ok: boolean | null; yes: string; no: string; unknown: string }) {
  return (
    <div className="list__row">
      <span className={cx("bubble", ok === true && "bubble--lime")}>{ok === null ? <Activity /> : ok ? <TrendingUp /> : <TrendingDown />}</span>
      <div className="list__main">
        <b>{ok === null ? unknown : ok ? yes : no}</b>
      </div>
    </div>
  );
}
