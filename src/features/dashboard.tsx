"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  CheckCheck,
  LineChart,
  ListChecks,
  Percent,
  Plus,
  Scale,
  Settings,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { AlertIcon, ALERT_LABEL, ALERT_TONE, BUCKET_TONE, BucketIcon } from "@/features/shared";
import { AddAmount } from "@/features/add-amount";
import type { LedgerRow, Summary } from "@/lib/engine";
import { egp, formatDate, pct, signedEgp, signedPct } from "@/lib/format";
import { BOOK_LABEL } from "@/lib/types";
import { usePortfolio } from "@/state/portfolio-provider";
import { Badge, Bubble, Button, Card, CardHead, Empty, IconButton, PageHead, StatCard, type Tone } from "@/ui";
import { Gauge, PillBars, type BarDatum } from "@/ui/charts";
import { Mixed, N } from "@/ui/text";

function signedPoints(gap: number): string {
  const rounded = Math.round(gap);
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}`;
}

const MONTHS_SHOWN = 8;

function previousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, "0")}`;
}

/** Month-end portfolio value against the money paid in by then, for the last eight months. */
function monthlyBars(history: Summary["history"], ledger: LedgerRow[]): BarDatum[] {
  const lastOfMonth = new Map<string, { date: string; value: number }>();
  for (const point of history) lastOfMonth.set(point.date.slice(0, 7), point);
  const flows = ledger.filter((row) => row.type === "deposit" || row.type === "withdraw");
  const months = [...lastOfMonth.keys()].sort().slice(-MONTHS_SHOWN);
  if (months.length === 0) return [];
  // a young portfolio still gets a full row of columns: the months before the first deposit show as empty tracks
  while (months.length < MONTHS_SHOWN) months.unshift(previousMonth(months[0]));
  return months.map((month) => {
    const point = lastOfMonth.get(month);
    const label = `${month.slice(5)}/${month.slice(2, 4)}`;
    const name = formatDate(`${month}-01`, { month: "long", year: "numeric" });
    if (!point) return { label, value: 0, inner: 0, title: `${name}: قبل بداية المحفظة` };
    const paid = flows
      .filter((row) => row.date <= point.date)
      .reduce((sum, row) => sum + (row.type === "deposit" ? row.amount : -row.amount), 0);
    return {
      label,
      value: Math.round(point.value),
      inner: Math.round(paid),
      title: `${name}: القيمة ${egp(point.value)} · المدفوع ${egp(paid)}`,
    };
  });
}

export function Dashboard() {
  const app = usePortfolio();
  const data = app.data!;
  const s = data.summary;
  const { config } = data;

  const bars = useMemo(() => monthlyBars(s.history, data.ledger), [s.history, data.ledger]);

  const stages = [...config.stages].sort((a, b) => a.min_value - b.min_value);
  const next = stages.find((stage) => stage.min_value > s.total + 1e-9);
  const progress = next ? Math.max(0, Math.min(100, (s.total / next.min_value) * 100)) : 100;
  const tiles = 30;
  const tilesOn = Math.round((progress / 100) * tiles);

  // 100 = every bucket exactly on target; each point off target (in either direction) costs half a point.
  // A gated bucket's share waiting in cash is the plan working, so that part of the two gaps does not count.
  const gatedShort = s.allocation.reduce((sum, row) => sum + (config.buckets[row.bucket]?.gate?.closed ? Math.max(0, -row.gap) : 0), 0);
  const cashOver = Math.max(0, s.allocation.find((row) => row.bucket === "cash")?.gap ?? 0);
  const offTarget = s.allocation.reduce((sum, row) => sum + Math.abs(row.gap), 0) - 2 * Math.min(gatedShort, cashOver);
  const fit = Math.max(0, Math.round(100 - offTarget / 2));

  const query = app.searchQuery.trim().toLocaleLowerCase();
  const orders = s.plan.orders.filter((order) => !query || `${order.name} ${order.label} ${order.instrument}`.toLocaleLowerCase().includes(query));

  const empty = data.ledger.length === 0;
  const verdict = s.review.verdict === "on_track" ? "الأداء ماشي مع الخطة" : s.review.verdict === "hold" ? "كمّل بنفس المبلغ" : "لسه بدري على الحكم";

  const shortcuts: Array<{ href: string; title: string; hint: string; tone: Tone; icon: React.ReactNode }> = [
    { href: "/plan", title: "خطة الشراء", hint: "توزيع مبلغ الشهر والمراحل الجاية", tone: "mint", icon: <ListChecks /> },
    { href: "/ledger", title: "العمليات", hint: "سجّل الإيداع والشراء والبيع والعائد", tone: "lilac", icon: <ArrowLeftRight /> },
    { href: "/prices", title: "الأسعار والأرصدة", hint: "حدّث قيمة كل أداة من تطبيقها", tone: "peach", icon: <LineChart /> },
    { href: "/settings", title: "الإعدادات", hint: "الإضافة الشهرية وأرقام السوق", tone: "sand", icon: <Settings /> },
  ];

  return (
    <>
      <PageHead
        eyebrow={
          <>
            {BOOK_LABEL[data.book]} · {formatDate(data.asof, { weekday: "long", day: "numeric", month: "long" })}
          </>
        }
        title="لوحة المحفظة"
        subtitle="قيمة المحفظة، توزيعها مقابل المستهدف، وإيه اللي المفروض يتشتري الشهر ده."
        actions={
          <>
            <Button href="/prices">تحديث الأرصدة</Button>
            <Button variant="ink" icon={<Plus />} href="/ledger">
              تسجيل عملية
            </Button>
          </>
        }
      />

      <div className="bento">
        {/* hero */}
        <Card className="hero hero--plain span-7">
          <Image className="hero__img" src="/images/hero.jpg" alt="" fill priority sizes="(max-width: 1180px) 100vw, 58vw" />
          <div>
            <span className="glass-chip">
              المرحلة <N>{s.stage.name}</N> · <Mixed text={s.stage.label} />
            </span>
            <h2 className="hero__title" style={{ marginTop: 16 }}>
              {empty ? "ابدأ بتسجيل أول إيداع" : verdict}
            </h2>
            <p className="hero__desc">
              {empty ? (
                "سجّل المبلغ اللي حوّلته، والنظام هيقسّمه على الأدوات حسب الخطة."
              ) : s.review.verdict === "early" ? (
                <>
                  مرّ <N>{s.days_running}</N> يوم من <N>{config.rules.review_min_days}</N> مطلوبين قبل أول تقييم للأداء مقابل خط الأساس.
                </>
              ) : (
                <Mixed text={s.review.text} />
              )}
            </p>
          </div>
          <div className="hero__foot">
            <div className="stat-row">
              <div>
                <b>
                  <N>{egp(s.contributions)}</N>
                </b>
                <span style={{ color: "rgba(255,255,255,.8)" }}>إجمالي المدفوع (جنيه)</span>
              </div>
              <div>
                <b>
                  <N>{egp(s.plan.investable)}</N>
                </b>
                <span style={{ color: "rgba(255,255,255,.8)" }}>جاهز للتوزيع (جنيه)</span>
              </div>
            </div>
            <Button variant="ink" arrow href={empty ? "/ledger" : "/plan"}>
              {empty ? "سجّل الإيداع" : "خطة الشراء"}
            </Button>
          </div>
        </Card>

        {/* stage progress */}
        <Card tone="sky" className="span-5">
          <CardHead
            title={next ? "التقدم للمرحلة الجاية" : "أعلى مرحلة في الخطة"}
            hint={
              next ? (
                <>
                  المرحلة <N>{next.name}</N> بتبدأ عند <N>{egp(next.min_value)}</N> جنيه وبتغيّر التوزيع المستهدف.
                </>
              ) : (
                "المحفظة وصلت آخر مرحلة معرّفة في الخطة."
              )
            }
            actions={
              <Badge tone="lime">
                <N>{`${Math.round(progress)}%`}</N>
              </Badge>
            }
          />
          <div className="tiles" aria-hidden>
            {Array.from({ length: tiles }, (_, index) => (
              <i key={index} className={index < tilesOn ? "on" : undefined} />
            ))}
          </div>
          <div className="card__grow" />
          <div className="row row--between row--wrap" style={{ alignItems: "flex-end" }}>
            <div className="stat-row">
              <div>
                <b>
                  <N>{egp(s.invested)}</N>
                </b>
                <span>مستثمر</span>
              </div>
              <div>
                <b>
                  <N>{egp(s.wallet)}</N>
                </b>
                <span>رصيد غير موزع</span>
              </div>
              <div>
                <b>
                  <N>{s.days_running}</N>
                </b>
                <span>يوم تشغيل</span>
              </div>
            </div>
            <div style={{ textAlign: "end" }}>
              <div className="num">
                <N>{egp(s.total)}</N>
              </div>
              <span className="t-label">قيمة المحفظة (جنيه)</span>
            </div>
          </div>
        </Card>

        {/* key figures */}
        <StatCard
          className="span-3"
          tone="lime"
          label="قيمة المحفظة"
          value={<N>{egp(s.total)}</N>}
          unit="ج.م"
          hint={
            <>
              المدفوع <N>{egp(s.contributions)}</N> جنيه
            </>
          }
          icon={<Wallet />}
        />
        <StatCard
          className="span-3"
          label="الربح / الخسارة"
          value={<N>{signedEgp(s.pnl)}</N>}
          unit="ج.م"
          hint={
            <>
              <N>{signedPct(s.pnl_pct)}</N> على المدفوع
            </>
          }
          icon={s.pnl < -0.5 ? <TrendingDown /> : <TrendingUp />}
        />
        <StatCard
          className="span-3"
          tone="lilac"
          label="مقابل خط الأساس"
          value={<N>{s.benchmark.meaningful ? signedEgp(s.benchmark.diff) : "—"}</N>}
          unit={s.benchmark.meaningful ? "ج.م" : undefined}
          hint={s.benchmark.meaningful ? "الفرق عن وضع كل الفلوس في صندوق النقد" : "المقارنة بتبدأ بعد شهر من أسعار صندوق النقد"}
          icon={<Scale />}
        />
        <StatCard
          className="span-3"
          tone="mint"
          label="عائد النقد السنوي"
          value={<N>{s.cash_yield === null ? "—" : pct(s.cash_yield)}</N>}
          hint={
            <>
              الفايدة <N>{pct(s.macro.cbe_deposit_rate ?? 0, 0)}</N> · التضخم <N>{pct(s.macro.inflation_urban ?? 0)}</N>
            </>
          }
          icon={<Percent />}
        />

        {/* trend */}
        <Card className="span-5">
          <CardHead
            title="قيمة المحفظة شهريًا"
            hint="آخر قيمة في كل شهر مقابل اللي اتدفع لحد وقتها"
            actions={
              <div className="legend">
                <span>
                  <i className="l2" />
                  القيمة
                </span>
                <span>
                  <i />
                  المدفوع
                </span>
              </div>
            }
          />
          {bars.length === 0 ? <Empty icon={<LineChart />} title="لسه مفيش بيانات" description="الرسم بيظهر بعد أول إيداع." /> : <PillBars hot={bars.length - 1} data={bars} />}
        </Card>

        {/* allocation vs target */}
        <Card className="span-4">
          <CardHead title="التوزيع مقابل المستهدف" hint="الشرطة هي النسبة المستهدفة للمرحلة الحالية" />
          <div className="stack" style={{ gap: 16 }}>
            {s.allocation.map((row) => (
              <div key={row.bucket} className="stack" style={{ gap: 8 }}>
                <div className="row row--between">
                  <b style={{ fontWeight: 550 }}>{row.label}</b>
                  <span className="t-small t-muted">
                    <N>{`${row.weight.toFixed(0)}%`}</N> / <N>{`${row.target.toFixed(0)}%`}</N>
                  </span>
                </div>
                <div className="progress progress--target" role="img" aria-label={`${row.label}: ${row.weight.toFixed(0)}% من ${row.target.toFixed(0)}% مستهدف`}>
                  <i style={{ width: `${Math.min(100, row.weight)}%` }} />
                  <u style={{ insetInlineStart: `${Math.min(100, row.target)}%` }} />
                </div>
                <div className="row row--wrap t-small t-muted" style={{ gap: 14 }}>
                  <span>
                    القيمة: <N>{egp(row.value)}</N>
                  </span>
                  <span>
                    الفرق: <N>{signedPoints(row.gap)}</N> نقطة
                  </span>
                  {s.reserved[row.bucket] ? (
                    <span>
                      مقفولة، ونصيبها في النقد: <N>{egp(s.reserved[row.bucket])}</N>
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* health */}
        <Card className="span-3 m-full">
          <CardHead title="صحة المحفظة" hint="قرب التوزيع الفعلي من المستهدف" />
          <Gauge value={fit}>
            <div className="num num--md">
              <N>{`${fit}%`}</N>
            </div>
            <span className="t-small t-muted">مطابقة التوزيع</span>
          </Gauge>
          <div className="stack" style={{ gap: 8 }}>
            <div className="pill-row">
              <Bubble>
                <TrendingDown />
              </Bubble>
              <span className="grow t-small">الهبوط من القمة</span>
              <b>
                <N>{pct(Math.abs(s.drawdown))}</N>
              </b>
            </div>
            <div className="pill-row">
              <Bubble>
                <TrendingDown />
              </Bubble>
              <span className="grow t-small">أقصى هبوط حصل</span>
              <b>
                <N>{pct(Math.abs(s.max_drawdown))}</N>
              </b>
            </div>
          </div>
        </Card>

        {/* this month's orders */}
        <Card className="span-7">
          <CardHead
            title="المطلوب شراؤه الشهر ده"
            hint={
              <>
                توزيع <N>{egp(s.plan.investable)}</N> جنيه (الرصيد غير الموزع + الإضافة)
              </>
            }
            actions={
              <>
                <AddAmount />
                <IconButton label="فتح خطة الشراء" variant="ink" size="sm" href="/plan">
                  <ArrowUpRight className="flip" />
                </IconButton>
              </>
            }
          />
          {orders.length === 0 ? (
            <Empty icon={<CheckCheck />} title={query ? "مفيش نتائج للبحث" : "مفيش مبلغ للتوزيع"} description={query ? undefined : "اكتب مبلغ الإضافة فوق علشان تشوف توزيعه."} />
          ) : (
            <div className="list">
              {orders.map((order) => (
                <div key={order.bucket} className="list__row">
                  <span className="list__time">
                    <N>{egp(order.amount)}</N>
                  </span>
                  <Bubble>
                    <BucketIcon bucket={order.bucket} />
                  </Bubble>
                  <div className="list__main">
                    <b>{order.name}</b>
                    <span>{order.label}</span>
                  </div>
                  <Button size="sm" variant="soft" href={`/ledger?op=buy&instrument=${order.instrument}&amount=${order.amount}`}>
                    سجّل الشراء
                  </Button>
                </div>
              ))}
              {s.plan.transfers.map((transfer) => (
                <div key={transfer.to} className="list__row">
                  <span className="list__time">
                    <N>{egp(transfer.amount)}</N>
                  </span>
                  <Bubble tone="lime">
                    <BucketIcon bucket={transfer.to_bucket} />
                  </Bubble>
                  <div className="list__main">
                    <b>تحويل من النقد إلى {transfer.to_name}</b>
                    <span>اتجمّع في النقد ما يكفي لشراء حصة كاملة</span>
                  </div>
                  <Badge tone={BUCKET_TONE[transfer.to_bucket]}>تحويل</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* alerts */}
        <Card className="span-5">
          <CardHead
            title="التنبيهات"
            hint="قواعد الخطة اللي اتفعّلت دلوقتي"
            actions={
              <Badge tone={s.alerts.some((a) => a.level !== "info") ? "peach" : "mint"} plain>
                <N>{s.alerts.length}</N>
              </Badge>
            }
          />
          {s.alerts.length === 0 ? (
            <Empty icon={<CheckCheck />} title="كل القواعد تمام" description="مفيش تنبيهات على المحفظة دلوقتي." />
          ) : (
            <div className="list">
              {s.alerts.map((alert, index) => (
                <div key={`${alert.code}-${index}`} className="list__row alert-row">
                  <Bubble tone={alert.level === "action" ? "ink" : undefined}>
                    <AlertIcon level={alert.level} />
                  </Bubble>
                  <p>
                    <Mixed text={alert.text} />
                  </p>
                  <Badge tone={ALERT_TONE[alert.level]}>{ALERT_LABEL[alert.level]}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* workspaces */}
        {shortcuts.map((item) => (
          <Card key={item.href} tone={item.tone} className="span-3">
            <div className="row row--between">
              <Bubble tone="glass">{item.icon}</Bubble>
              <IconButton label={`فتح ${item.title}`} variant="ink" size="sm" href={item.href}>
                <ArrowUpRight className="flip" />
              </IconButton>
            </div>
            <div className="card__grow" style={{ minHeight: 18 }} />
            <Link href={item.href}>
              <h3 className="t-title">{item.title}</h3>
            </Link>
            <p className="t-small t-label">{item.hint}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
