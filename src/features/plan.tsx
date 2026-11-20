"use client";

import { CheckCheck, ListChecks, OctagonAlert, PiggyBank } from "lucide-react";
import { AddAmount } from "@/features/add-amount";
import { BUCKET_TONE, BucketIcon } from "@/features/shared";
import { egp, egp2, formatDate, pct, price as formatPrice, signedEgp, signedPct, units as formatUnits } from "@/lib/format";
import { BOOK_LABEL } from "@/lib/types";
import { usePortfolio } from "@/state/portfolio-provider";
import { Badge, Bubble, Button, Card, CardHead, Empty, Notice, PageHead } from "@/ui";
import { D, Mixed, N } from "@/ui/text";

export function PlanScreen() {
  const app = usePortfolio();
  const data = app.data!;
  const s = data.summary;
  const { config } = data;
  const stages = [...config.stages].sort((a, b) => a.min_value - b.min_value);
  const parked = Object.entries(s.plan.parked);

  return (
    <>
      <PageHead
        eyebrow={
          <>
            <ListChecks /> {BOOK_LABEL[data.book]} · {formatDate(data.asof, { day: "numeric", month: "long", year: "numeric" })}
          </>
        }
        title="خطة الشراء"
        subtitle="الفلوس الجديدة بتروح للأدوات اللي تحت المستهدف. مفيش بيع علشان إعادة التوازن."
        actions={
          <>
            <span className="t-label">مبلغ الإضافة</span>
            <AddAmount />
          </>
        }
      />

      <div className="bento">
        <Card tone="ink" className="span-4">
          <div className="row row--between">
            <span className="t-label">المبلغ اللي بيتوزع</span>
            <Bubble tone="lime">
              <PiggyBank />
            </Bubble>
          </div>
          <div className="card__grow" style={{ minHeight: 24 }} />
          <div className="num">
            <N>{egp(s.plan.investable)}</N>
            <small style={{ color: "rgba(243,244,239,.62)" }}>ج.م</small>
          </div>
          <p className="t-small t-muted">
            رصيد غير موزع <N>{egp(s.wallet)}</N> + إضافة <N>{egp(data.add)}</N>
          </p>
          <div className="row row--wrap" style={{ gap: 6 }}>
            <Badge tone="lime">
              المرحلة <N>{s.plan.stage.name}</N>
            </Badge>
            {s.plan.stage_changed ? <Badge tone="peach">مرحلة جديدة بعد الإضافة</Badge> : null}
          </div>
        </Card>

        <Card className="span-8">
          <CardHead title="أوامر الشهر" hint="نفّذها في التطبيقات، وبعدين سجّل كل واحدة هنا" />
          {s.plan.stopped ? (
            <Notice icon={<OctagonAlert />}>قاعدة الإيقاف مفعّلة: كل الإضافات متوقفة ما عدا النقد والذهب لحد ما الهبوط يقل.</Notice>
          ) : null}
          {s.plan.blocked.map((bucket) => (
            <Notice key={bucket} icon={<OctagonAlert />}>
              «{config.buckets[bucket]?.label ?? bucket}» مقفولة للشراء دلوقتي حسب قاعدة الاتجاه، ونصيبها اتوزّع على باقي الأدوات. التفاصيل في التنبيهات.
            </Notice>
          ))}
          {s.plan.orders.length === 0 && s.plan.transfers.length === 0 ? (
            <Empty icon={<CheckCheck />} title="مفيش مبلغ للتوزيع" description="اكتب مبلغ الإضافة فوق، أو سجّل إيداع من شاشة العمليات." />
          ) : (
            <div className="list">
              {s.plan.orders.map((order) => (
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
                    <span>بيع من صندوق النقد بالقيمة دي ثم شراء الحصة</span>
                  </div>
                  <Badge tone={BUCKET_TONE[transfer.to_bucket]}>تحويل</Badge>
                </div>
              ))}
            </div>
          )}
          {parked.map(([bucket, amount]) => (
            <Notice key={bucket}>
              نصيب «{config.buckets[bucket]?.label ?? bucket}» الشهر ده <N>{egp2(amount)}</N> جنيه، أقل من أصغر شراء ممكن (<N>{egp(config.buckets[bucket]?.min_order ?? 0)}</N>)، فاتركن في النقد لحد ما يكمل.
            </Notice>
          ))}
        </Card>

        {stages.map((stage) => {
          const current = stage.name === s.stage.name;
          const entries = Object.entries(stage.targets).sort((a, b) => b[1] - a[1]);
          return (
            <Card key={stage.name} tone={current ? undefined : "soft"} className="span-4">
              <CardHead
                title={
                  <>
                    المرحلة <N>{stage.name}</N>
                  </>
                }
                hint={
                  stage.min_value > 0 ? (
                    <>
                      من <N>{egp(stage.min_value)}</N> جنيه
                    </>
                  ) : (
                    "من أول جنيه"
                  )
                }
                actions={current ? <Badge tone="lime">الحالية</Badge> : undefined}
              />
              <div className="stack" style={{ gap: 10 }}>
                {entries.map(([bucket, target]) => (
                  <div key={bucket} className="hbar">
                    <span className="truncate">{config.buckets[bucket]?.label ?? bucket}</span>
                    <div className="hbar__track">
                      <div className="hbar__fill" style={{ width: `${target}%` }} />
                    </div>
                    <b className="amt">
                      <N>{`${target}%`}</N>
                    </b>
                  </div>
                ))}
              </div>
              {(stage.notes ?? []).map((note) => (
                <p key={note} className="t-small t-muted">
                  <Mixed text={note} />
                </p>
              ))}
            </Card>
          );
        })}

        <Card className="span-6">
          <CardHead title="قواعد التشغيل" hint="بتتطبق تلقائيًا في التنبيهات وخطة الشراء" />
          <div className="kv">
            <div>
              <b>
                <N>{pct(config.rules.warn_drawdown, 0)}</N>
              </b>
              <span>هبوط يوقف زيادة المبلغ</span>
            </div>
            <div>
              <b>
                <N>{pct(config.rules.stop_drawdown, 0)}</N>
              </b>
              <span>هبوط يقفل كل شيء عدا النقد والذهب</span>
            </div>
            <div>
              <b>
                <N>{config.rules.review_min_days}</N>
              </b>
              <span>يوم قبل أول حكم على الأداء</span>
            </div>
            <div>
              <b>
                <N>{pct(config.rules.min_cash_yield, 0)}</N>
              </b>
              <span>أقل عائد مقبول لصندوق النقد</span>
            </div>
            <div>
              <b>
                <N>{config.rules.stale_days}</N>
              </b>
              <span>يوم ويتعتبر السعر قديم</span>
            </div>
            <div>
              <b>
                <N>{egp(config.monthly_contribution)}</N>
              </b>
              <span>الإضافة الشهرية (جنيه)</span>
            </div>
          </div>
        </Card>

        <Card className="span-6">
          <CardHead title="المراجعة" hint={<Mixed text={s.review.text} />} />
          <div className="stmt">
            <div className="stmt__row">
              <span>إجمالي المدفوع</span>
              <span className="amt">
                <N>{egp2(s.contributions)}</N>
              </span>
            </div>
            <div className="stmt__row">
              <span>قيمة المحفظة</span>
              <span className="amt">
                <N>{egp2(s.total)}</N>
              </span>
            </div>
            <div className="stmt__row">
              <span>العائد الزمني (من غير أثر الإيداعات)</span>
              <span className={`amt${s.twr < -0.0005 ? " amt--neg" : ""}`}>
                <N>{signedPct(s.twr)}</N>
              </span>
            </div>
            <div className="stmt__row">
              <span>نفس العائد كمعدل سنوي</span>
              <span className="amt">{s.annualised === null ? <span className="amt--zero">بعد 90 يوم</span> : <N>{signedPct(s.annualised)}</N>}</span>
            </div>
            <div className="stmt__row">
              <span>خط الأساس (كل الفلوس في صندوق النقد)</span>
              <span className="amt">
                <N>{egp2(s.benchmark.value)}</N>
              </span>
            </div>
            <div className="stmt__row stmt__row--total">
              <span>الفرق عن خط الأساس</span>
              <span className={`amt${s.benchmark.diff < -0.5 ? " amt--neg" : ""}`}>
                <N>{signedEgp(s.benchmark.diff)}</N>
              </span>
            </div>
          </div>
        </Card>

        <Card className="span-12">
          <CardHead title="المملوك حاليًا" hint="الكمية × آخر سعر مسجّل" />
          {s.holdings.length === 0 ? (
            <Empty icon={<ListChecks />} title="لسه مفيش مشتريات" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الأداة</th>
                    <th className="num-col">الكمية</th>
                    <th className="num-col">السعر</th>
                    <th className="num-col">القيمة</th>
                    <th>آخر تحديث للسعر</th>
                  </tr>
                </thead>
                <tbody>
                  {s.holdings.map((holding) => (
                    <tr key={holding.instrument}>
                      <td>
                        <div className="cell-main">
                          <Bubble>
                            <BucketIcon bucket={holding.bucket} />
                          </Bubble>
                          <div>
                            <b>{holding.name}</b>
                            <span>{config.buckets[holding.bucket]?.label}</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="الكمية" className="num-col amt">
                        <N>{formatUnits(holding.units)}</N> {holding.unit}
                      </td>
                      <td data-label="السعر" className="num-col amt">
                        <N>{formatPrice(holding.price)}</N>
                      </td>
                      <td data-label="القيمة" className="num-col amt">
                        <N>{egp2(holding.value)}</N>
                      </td>
                      <td data-label="آخر تحديث للسعر">
                        {holding.stale ? (
                          <Badge tone="peach">قديم · {holding.price_date ? <D>{formatDate(holding.price_date)}</D> : "سعر آخر عملية"}</Badge>
                        ) : (
                          <Badge tone="mint">{holding.price_date ? <D>{formatDate(holding.price_date)}</D> : "ثابت"}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
