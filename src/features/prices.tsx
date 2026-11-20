"use client";

import { useState } from "react";
import { CircleCheck, LineChart, RefreshCw, TriangleAlert } from "lucide-react";
import { BucketIcon, REFERENCE_LABEL } from "@/features/shared";
import { egp2, formatDate, price as formatPrice, signedPct, units as formatUnits } from "@/lib/format";
import { BOOK_LABEL } from "@/lib/types";
import { usePortfolio } from "@/state/portfolio-provider";
import { Badge, Bubble, Button, Card, CardHead, Empty, Field, Input, Notice, PageHead, Select } from "@/ui";
import { D, N } from "@/ui/text";

export function PricesScreen() {
  const app = usePortfolio();
  const data = app.data!;
  const s = data.summary;
  const { config } = data;
  const instruments = Object.entries(config.instruments);

  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [date, setDate] = useState(data.today);
  const [manualInstrument, setManualInstrument] = useState(instruments.find(([code]) => code !== "CASH")?.[0] ?? instruments[0]?.[0] ?? "");
  const [manualPrice, setManualPrice] = useState("");
  const [rate, setRate] = useState("18");

  const post = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    const done = await app.send("POST", "/api/prices", { book: data.book, date, ...body });
    setBusy(null);
    return done;
  };

  const mark = async (instrument: string) => {
    if (await post(`mark:${instrument}`, { op: "mark", instrument, value: values[instrument] })) {
      setValues((current) => ({ ...current, [instrument]: "" }));
    }
  };

  const own = data.prices.filter((row) => !row.instrument.startsWith("REF_"));
  const reference = data.prices.filter((row) => row.instrument.startsWith("REF_"));
  const cashHeld = s.holdings.some((holding) => holding.instrument === "CASH");

  return (
    <>
      <PageHead
        eyebrow={
          <>
            <LineChart /> {BOOK_LABEL[data.book]}
          </>
        }
        title="الأسعار والأرصدة"
        subtitle="قيمة كل أداة هي اللي ظاهرة في تطبيقها. اكتبها هنا مرة في الشهر على الأقل قبل تنفيذ خطة الشراء."
        actions={
          <Field label="تاريخ القراءة">
            <Input className="input--sm" type="date" dir="ltr" max={data.today} value={date} onChange={(event) => setDate(event.target.value || data.today)} />
          </Field>
        }
      />

      <div className="bento">
        <Card className="span-7">
          <CardHead title="أرصدة أدواتك" hint="اكتب القيمة الإجمالية الظاهرة في التطبيق، والسعر بيتحسب منها" />
          {s.holdings.length === 0 ? (
            <Empty icon={<LineChart />} title="لسه مفيش أدوات مملوكة" description="بعد أول شراء هتظهر هنا علشان تحدّث قيمتها." />
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {s.holdings.map((holding) => {
                const fixed = Boolean(config.instruments[holding.instrument]?.fixed_price);
                return (
                  <div key={holding.instrument} className="jline">
                    <div className="row" style={{ minWidth: 0 }}>
                      <Bubble>
                        <BucketIcon bucket={holding.bucket} />
                      </Bubble>
                      <div className="list__main">
                        <b>{holding.name}</b>
                        <span>
                          <N>{formatUnits(holding.units)}</N> {holding.unit} ·{" "}
                          {holding.stale ? (
                            <bdi className="t-warn">سعر قديم</bdi>
                          ) : holding.price_date ? (
                            <D>{formatDate(holding.price_date, { day: "numeric", month: "short" })}</D>
                          ) : (
                            "سعر ثابت"
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="amt" style={{ textAlign: "end" }}>
                      <N>{egp2(holding.value)}</N>
                    </div>
                    <Input
                      className="input--sm"
                      type="number"
                      inputMode="decimal"
                      dir="ltr"
                      min="0"
                      step="0.01"
                      placeholder={fixed ? "ثابت" : "القيمة الآن"}
                      aria-label={`القيمة الحالية لـ ${holding.name}`}
                      value={values[holding.instrument] ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, [holding.instrument]: event.target.value }))}
                    />
                    <Button size="sm" variant="ink" disabled={!values[holding.instrument] || busy !== null} onClick={() => void mark(holding.instrument)}>
                      حدّث
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="span-5">
          <CardHead title="سعر وحدة يدوي" hint="لأداة لسه مشترتهاش، أو لما تعرف سعر الوحدة مباشرة" />
          <div className="form-grid">
            <Field label="الأداة" className="full">
              <Select value={manualInstrument} onChange={(event) => setManualInstrument(event.target.value)}>
                {instruments.map(([code, item]) => (
                  <option key={code} value={code}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="سعر الوحدة بالجنيه" className="full">
              <Input type="number" inputMode="decimal" dir="ltr" min="0" step="any" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} />
            </Field>
            <div className="full row" style={{ justifyContent: "flex-end" }}>
              <Button
                variant="ink"
                disabled={!manualPrice || busy !== null}
                onClick={async () => {
                  if (await post("set", { op: "set", instrument: manualInstrument, price: manualPrice })) setManualPrice("");
                }}
              >
                حفظ السعر
              </Button>
            </div>
          </div>
          {data.book === "paper" ? (
            <>
              <div className="rail__sep" style={{ margin: 0 }} />
              <CardHead title="محاكاة عائد النقد" hint="للدفتر التجريبي فقط: نمّي سعر صندوق النقد بمعدل سنوي لحد تاريخ القراءة" />
              <div className="row row--wrap">
                <Input
                  className="input--sm input--mini"
                  type="number"
                  inputMode="decimal"
                  dir="ltr"
                  min="-50"
                  max="100"
                  step="0.5"
                  aria-label="المعدل السنوي بالمئة"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                />
                <span className="t-small t-muted grow">% سنويًا</span>
                <Button size="sm" variant="soft" disabled={!cashHeld || busy !== null || rate === ""} onClick={() => void post("accrue", { op: "accrue", instrument: "CASH", rate: Number(rate) / 100 })}>
                  طبّق
                </Button>
              </div>
              {!cashHeld ? <p className="t-small t-muted">بيشتغل بعد أول شراء في صندوق النقد.</p> : null}
            </>
          ) : null}
        </Card>

        <Card className="span-7">
          <CardHead title="آخر القراءات" hint="آخر سعر مسجّل لكل أداة في الدفتر ده" />
          {own.length === 0 ? (
            <Empty icon={<LineChart />} title="لسه مفيش أسعار مسجّلة" />
          ) : (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th>الأداة</th>
                    <th className="num-col">السعر</th>
                    <th className="num-col">التغير</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {own.map((row) => {
                    const change = row.previous ? row.price / row.previous - 1 : null;
                    return (
                      <tr key={row.instrument}>
                        <td>
                          <div className="cell-main">
                            <div>
                              <b>{config.instruments[row.instrument]?.name ?? row.instrument}</b>
                              <span>
                                <N>{row.points}</N> قراءة
                              </span>
                            </div>
                          </div>
                        </td>
                        <td data-label="السعر" className="num-col amt">
                          <N>{formatPrice(row.price)}</N>
                        </td>
                        <td data-label="التغير" className={`num-col amt${change !== null && change < 0 ? " amt--neg" : ""}`}>
                          {change === null ? <span className="amt--zero">—</span> : <N>{signedPct(change, 2)}</N>}
                        </td>
                        <td data-label="التاريخ">
                          <D>{formatDate(row.date)}</D>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card tone="sand" className="span-5">
          <CardHead
            title="أسعار مرجعية"
            hint="مصادر عامة مجانية، للسياق فقط"
            actions={
              <Button size="sm" variant="ink" icon={<RefreshCw className={app.pulling ? "spin" : undefined} />} disabled={app.pulling} onClick={() => void app.pullReference()}>
                تحديث الآن
              </Button>
            }
          />
          {reference.length === 0 ? (
            <p className="t-small t-label">لسه ما اتسحبتش. اضغط «تحديث الآن»، وبعد كده بتتحدّث لوحدها مرة كل يوم.</p>
          ) : (
            <div className="list">
              {reference.map((row) => (
                <div key={row.instrument} className="list__row">
                  <div className="list__main">
                    <b>{REFERENCE_LABEL[row.instrument] ?? row.instrument}</b>
                    <span>
                      <D>{formatDate(row.date)}</D> · <N>{row.points}</N> قراءة
                    </span>
                  </div>
                  <b className="amt">
                    <N>{formatPrice(row.price)}</N>
                  </b>
                </div>
              ))}
            </div>
          )}
          {app.fetchReport ? (
            <div className="stack" style={{ gap: 6 }}>
              {app.fetchReport.ok.length ? (
                <div className="row t-small">
                  <CircleCheck size={15} />
                  <span>
                    اتحدّث: <N>{app.fetchReport.ok.length}</N>
                  </span>
                </div>
              ) : null}
              {Object.entries(app.fetchReport.failed).map(([name, reason]) => (
                <div key={name} className="row t-small">
                  <TriangleAlert size={15} />
                  <span>
                    فشل {REFERENCE_LABEL[name] ?? name}: <N>{reason}</N>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <Notice>سعر الذهب المحلي غالبًا أعلى من المحسوب هنا. قيمة ما تملكه هي اللي في تطبيق ثاندر.</Notice>
          {reference.some((row) => row.instrument === "REF_BTCUSD") ? <Badge tone="outline">قاعدة متوسط 200 يوم بتقرأ من سلسلة البيتكوين دي</Badge> : null}
        </Card>
      </div>
    </>
  );
}
