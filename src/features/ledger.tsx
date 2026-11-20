"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Check, Trash2, X } from "lucide-react";
import { OP_LABEL, OP_TONE } from "@/features/shared";
import type { LedgerRow } from "@/lib/engine";
import { egp2, formatDate, price as formatPrice, units as formatUnits } from "@/lib/format";
import { BOOK_LABEL } from "@/lib/types";
import { usePortfolio } from "@/state/portfolio-provider";
import { Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Notice, PageHead, Select, Switch, Tabs } from "@/ui";
import { D, N } from "@/ui/text";

type Op = "deposit" | "buy" | "sell" | "income" | "withdraw";

const OPS: Array<{ value: Op; label: string }> = [
  { value: "deposit", label: "إيداع" },
  { value: "buy", label: "شراء" },
  { value: "sell", label: "بيع" },
  { value: "income", label: "عائد" },
  { value: "withdraw", label: "سحب" },
];

const HELP: Record<Op, string> = {
  deposit: "فلوس حوّلتها للاستثمار. بتدخل الرصيد غير الموزع لحد ما تسجّل الشراء.",
  buy: "المبلغ هو كل اللي اتخصم منك شامل الرسوم. اكتب الكمية اللي استلمتها أو السعر؛ لو سبت الاتنين بيتحسب بآخر سعر معروف.",
  sell: "الحصيلة بترجع للرصيد غير الموزع. اكتب السعر اللي اتنفذ بيه البيع.",
  income: "توزيعات أو إيجار أو عائد شهادة دخل لك نقدًا. بيتضاف للرصيد غير الموزع.",
  withdraw: "فلوس خرجت من المحفظة خالص. لازم تكون موجودة في الرصيد غير الموزع.",
};

export function LedgerScreen() {
  const app = usePortfolio();
  const data = app.data!;
  const instruments = Object.entries(data.config.instruments);

  const [op, setOp] = useState<Op>("deposit");
  const [date, setDate] = useState(data.today);
  const [instrument, setInstrument] = useState(instruments[0]?.[0] ?? "");
  const [amount, setAmount] = useState("");
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [feePct, setFeePct] = useState("");
  const [feeTouched, setFeeTouched] = useState(false);
  const [note, setNote] = useState("");
  const [sellAll, setSellAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  // "سجّل الشراء" on the dashboard and plan screens links here with the order filled in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantedOp = params.get("op");
    if (wantedOp && OPS.some((item) => item.value === wantedOp)) setOp(wantedOp as Op);
    const wantedInstrument = params.get("instrument");
    if (wantedInstrument && wantedInstrument in data.config.instruments) setInstrument(wantedInstrument);
    const wantedAmount = params.get("amount");
    if (wantedAmount && Number(wantedAmount) > 0) setAmount(wantedAmount);
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const held = data.summary.holdings.find((h) => h.instrument === instrument);
  const meta = data.config.instruments[instrument];
  const usualFee = op === "buy" ? meta?.fees?.buy_pct : op === "sell" ? meta?.fees?.sell_pct : undefined;

  // The instrument's usual fee fills the field until you type your own; the ledger keeps what you submit.
  useEffect(() => {
    if (!feeTouched) setFeePct(usualFee === undefined ? "" : String(usualFee));
  }, [feeTouched, usualFee]);
  const needsInstrument = op === "buy" || op === "sell" || op === "income";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const body: Record<string, unknown> = { book: data.book, op, date, note };
    if (needsInstrument) body.instrument = instrument;
    if (op !== "sell") body.amount = amount;
    if (op === "buy" || op === "sell") {
      if (qty) body.units = qty;
      if (unitPrice) body.price = unitPrice;
      if (feePct) body.fee_pct = feePct;
    }
    if (op === "sell") body.sell_all = sellAll;
    const done = await app.send("POST", "/api/ledger", body);
    setBusy(false);
    if (done) {
      setAmount("");
      setQty("");
      setUnitPrice("");
      setNote("");
      setSellAll(false);
      setFeeTouched(false);
    }
  };

  const query = app.searchQuery.trim().toLocaleLowerCase();
  const rows = useMemo(
    () =>
      data.ledger.filter((row) => {
        if (!query) return true;
        const name = data.config.instruments[row.instrument]?.name ?? "";
        return `${OP_LABEL[row.type]} ${row.instrument} ${name} ${row.note} ${row.date}`.toLocaleLowerCase().includes(query);
      }),
    [data.ledger, data.config.instruments, query],
  );

  const remove = async (row: LedgerRow) => {
    setConfirmId(null);
    await app.send("DELETE", `/api/ledger?book=${data.book}&id=${row.id}`);
  };

  return (
    <>
      <PageHead
        eyebrow={
          <>
            <ArrowLeftRight /> {BOOK_LABEL[data.book]}
          </>
        }
        title="العمليات"
        subtitle="كل حركة فلوس بتتسجل هنا، والأرقام في باقي الشاشات بتتحسب منها."
      />

      <div className="bento">
        <Card className="span-5">
          <CardHead title="تسجيل عملية" hint={HELP[op]} />
          <Tabs filled label="نوع العملية" value={op} options={OPS} onChange={setOp} />
          <form className="form-grid" onSubmit={submit}>
            <Field label="التاريخ">
              <Input type="date" dir="ltr" required max={data.today} value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            {needsInstrument ? (
              <Field label="الأداة">
                <Select value={instrument} onChange={(event) => setInstrument(event.target.value)}>
                  {instruments.map(([code, item]) => (
                    <option key={code} value={code}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <div />
            )}

            {op !== "sell" ? (
              <Field label="المبلغ بالجنيه" className={op === "buy" ? undefined : "full"}>
                <Input type="number" inputMode="decimal" dir="ltr" required min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </Field>
            ) : null}

            {op === "buy" ? (
              <>
                <Field label={`الكمية${meta?.unit ? ` (${meta.unit})` : ""}`} optional="اختياري">
                  <Input type="number" inputMode="decimal" dir="ltr" min="0" step="any" value={qty} onChange={(event) => setQty(event.target.value)} />
                </Field>
                <Field label="سعر الوحدة" optional="اختياري">
                  <Input type="number" inputMode="decimal" dir="ltr" min="0" step="any" disabled={Boolean(qty)} value={qty ? "" : unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
                </Field>
                <Field label="الرسوم %" optional="اختياري">
                  <Input type="number" inputMode="decimal" dir="ltr" min="0" max="100" step="any" value={feePct}
                    onChange={(event) => {
                      setFeeTouched(true);
                      setFeePct(event.target.value);
                    }}
                  />
                </Field>
              </>
            ) : null}

            {op === "sell" ? (
              <>
                <Field label={`الكمية${meta?.unit ? ` (${meta.unit})` : ""}`} className={sellAll ? undefined : undefined}>
                  <Input type="number" inputMode="decimal" dir="ltr" min="0" step="any" required={!sellAll} disabled={sellAll} value={sellAll ? "" : qty} onChange={(event) => setQty(event.target.value)} />
                </Field>
                <Field label="سعر الوحدة" optional="اختياري">
                  <Input type="number" inputMode="decimal" dir="ltr" min="0" step="any" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
                </Field>
                <Field label="الرسوم %" optional="اختياري">
                  <Input type="number" inputMode="decimal" dir="ltr" min="0" max="100" step="any" value={feePct}
                    onChange={(event) => {
                      setFeeTouched(true);
                      setFeePct(event.target.value);
                    }}
                  />
                </Field>
                <div className="row row--between full pill-row">
                  <span className="t-small grow">
                    بيع كل المملوك
                    {held ? (
                      <>
                        {" "}
                        (<N>{formatUnits(held.units)}</N> {held.unit})
                      </>
                    ) : (
                      " (مفيش مملوك من الأداة دي)"
                    )}
                  </span>
                  <Switch checked={sellAll} onChange={setSellAll} label="بيع كل المملوك" />
                </div>
              </>
            ) : null}

            <Field label="ملاحظة" optional="اختياري" className="full">
              <Input maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>

            {usualFee !== undefined && (op === "buy" || op === "sell") ? (
              <p className="full t-small t-muted">
                الرسوم المعتادة لـ {meta?.name}: <N>{`${usualFee}%`}</N>. اتملت تلقائيًا، وعدّلها لو التطبيق خصم رقم مختلف.
              </p>
            ) : null}
            {meta?.terms && (op === "buy" || op === "sell") ? (
              <p className="full t-small t-muted">
                شروط {meta.name}: أقل شراء <N>{(meta.terms.min_buy ?? 0).toLocaleString("en-US")}</N> جنيه، الزيادة بمضاعفات{" "}
                <N>{(meta.terms.step ?? 0).toLocaleString("en-US")}</N>، والاسترداد بعد <N>{meta.terms.lock_days ?? 0}</N> يوم.
              </p>
            ) : null}

            <div className="full row row--between row--wrap">
              <span className="t-small t-muted">
                الرصيد غير الموزع: <N>{egp2(data.summary.wallet)}</N> جنيه
              </span>
              <button type="submit" className="btn btn--ink" disabled={busy}>
                {busy ? "جاري الحفظ…" : `تسجيل ${OPS.find((item) => item.value === op)?.label}`}
              </button>
            </div>
          </form>
        </Card>

        <Card className="span-7">
          <CardHead
            title="سجل العمليات"
            hint={
              <>
                <N>{rows.length}</N> عملية{query ? " مطابقة للبحث" : ""}، الأحدث أولًا
              </>
            }
          />
          {data.book === "paper" ? <Notice>ده الدفتر التجريبي: جرّب فيه براحتك. فلوسك الفعلية تتسجل في الدفتر الحقيقي من القائمة فوق.</Notice> : null}
          {rows.length === 0 ? (
            <Empty icon={<ArrowLeftRight />} title={query ? "مفيش عمليات مطابقة" : "لسه مفيش عمليات"} description={query ? undefined : "ابدأ بتسجيل إيداع من النموذج."} />
          ) : (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>العملية</th>
                    <th className="num-col">الكمية</th>
                    <th className="num-col">السعر</th>
                    <th className="num-col">المبلغ</th>
                    <th>
                      <span className="sr-only">إجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td data-label="التاريخ">
                        <D>{formatDate(row.date)}</D>
                      </td>
                      <td>
                        <div className="cell-main">
                          <Badge tone={OP_TONE[row.type]}>{OP_LABEL[row.type]}</Badge>
                          <div>
                            <b>{data.config.instruments[row.instrument]?.name ?? (row.instrument || "—")}</b>
                            {row.note ? <span>{row.note}</span> : null}
                          </div>
                        </div>
                      </td>
                      <td data-label="الكمية" className="num-col amt">
                        {row.units ? <N>{formatUnits(row.units)}</N> : <span className="amt--zero">—</span>}
                      </td>
                      <td data-label="السعر" className="num-col amt">
                        {row.price ? <N>{formatPrice(row.price)}</N> : <span className="amt--zero">—</span>}
                      </td>
                      <td data-label="المبلغ" className="num-col amt">
                        <N>{egp2(row.amount)}</N>
                        {row.fee ? (
                          <span className="sub">
                            رسوم <N>{egp2(row.fee)}</N>
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <div className="cell-actions">
                          {confirmId === row.id ? (
                            <>
                              <Button size="sm" variant="danger" icon={<Check />} onClick={() => void remove(row)}>
                                تأكيد الحذف
                              </Button>
                              <IconButton size="sm" variant="soft" label="إلغاء" onClick={() => setConfirmId(null)}>
                                <X />
                              </IconButton>
                            </>
                          ) : (
                            <IconButton size="sm" variant="soft" label="حذف العملية" onClick={() => setConfirmId(row.id ?? null)}>
                              <Trash2 />
                            </IconButton>
                          )}
                        </div>
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
