"use client";

import { useState } from "react";
import { CalendarCheck, Coins, Lock, Undo2 } from "lucide-react";
import type { BudgetView } from "@/lib/budget";
import { egp, egp2, pct, signedEgp } from "@/lib/format";
import { useBudget, type BudgetHandle } from "@/state/budget";
import { Badge, Button, Card, CardHead, Empty, Field, Input, Notice, PageHead, Select, cx } from "@/ui";
import { Gauge } from "@/ui/charts";
import { D, N } from "@/ui/text";
import { BudgetGate, BudgetNav, KIND_LABEL, KIND_TONE, cycleLabel, names, shortDate } from "./shared";

export function BudgetClose() {
  const [cycle, setCycle] = useState<string | null>(null);
  const budget = useBudget(cycle);
  return (
    <>
      <PageHead
        eyebrow={
          <>
            <CalendarCheck /> الميزانية
          </>
        }
        title="التقارير والإقفال"
        subtitle="صرفت كام في كل فئة، إيه اللي طلع من غير حساب، وكام يروح للاستثمار."
        actions={
          budget.data ? (
            <Select className="select--card" aria-label="الشهر" value={budget.data.selected.start} onChange={(event) => setCycle(event.target.value)}>
              {budget.data.cycles.map((c) => (
                <option key={c.start} value={c.start}>
                  {cycleLabel(c)}
                  {c.closed ? " · مقفول" : c.start === budget.data?.cycle.start ? " · الحالي" : " · مستني إقفال"}
                </option>
              ))}
            </Select>
          ) : null
        }
      />
      <BudgetNav />
      <BudgetGate budget={budget}>
        {(data) => (
          <div className="bento">
            <ClosePanel data={data} budget={budget} />
            <InvestPanel data={data} budget={budget} />
            <SpendReport data={data} />
            <InvestRate data={data} />
            <Incidentals data={data} />
            <Trends data={data} budget={budget} />
          </div>
        )}
      </BudgetGate>
    </>
  );
}

function ClosePanel({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const plan = data.pending_close;
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(false);
  const hasInvest = data.invest.category !== null;
  const lastClosed = data.cycles.find((c) => c.start === data.last_close);

  const undoButton = lastClosed ? (
    undo ? (
      <span className="row row--wrap">
        <span className="t-small">
          تلغي إقفال <D>{cycleLabel(lastClosed)}</D>؟
        </span>
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            setUndo(false);
            await budget.post({ op: "undo_close" });
          }}
        >
          أيوه، الغيه
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setUndo(false)}>
          لأ
        </Button>
      </span>
    ) : (
      <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => setUndo(true)}>
        تراجع عن آخر إقفال
      </Button>
    )
  ) : null;

  if (!plan) {
    return (
      <Card className="span-7">
        <CardHead title="إقفال الشهر" />
        <Empty
          icon={<Lock />}
          title="مفيش شهر مستني إقفال"
          description={`الشهر الحالي بينتهي يوم ${shortDate(data.cycle.end)}. بعدها هتراجع الأرقام هنا وتقفله، والباقي يروح للاستثمار.`}
        />
        {undoButton ? <div className="row row--wrap">{undoButton}</div> : null}
      </Card>
    );
  }

  return (
    <Card className="span-7" tone="mint">
      <CardHead
        title={
          <>
            إقفال شهر <D>{cycleLabel(plan.cycle)}</D>
          </>
        }
        hint="الباقي في فئات الصرف بيغطي زيادة الصرف، بعدين يرد السلف، واللي يفضل يروح للاستثمار."
      />
      <div className="stmt">
        <div className="stmt__row">
          <span>الباقي في فئات الصرف</span>
          <b className="amt">
            <N>{egp2(plan.leftover)}</N>
          </b>
        </div>
        <div className="stmt__row">
          <span>يغطي زيادة صرف في فئات تانية</span>
          <b className="amt">
            <N>{plan.covered ? `−${egp2(plan.covered)}` : "0.00"}</N>
          </b>
        </div>
        <div className="stmt__row">
          <span>يرد سلف بين الفئات</span>
          <b className="amt">
            <N>{plan.repaid ? `−${egp2(plan.repaid)}` : "0.00"}</N>
          </b>
        </div>
        <div className="stmt__row stmt__row--grand">
          <span>يروح للاستثمار</span>
          <b className="amt">
            <N>{egp2(plan.to_invest)}</N>
          </b>
        </div>
      </div>
      <ul className="checks t-small">
        <li>
          فئة العوارض بتفضل زي ما هي: <N>{egp2(plan.buffer)}</N> جنيه مرحّلة للشهر الجديد.
        </li>
        {plan.uncovered > 0 ? (
          <li>
            <N>{egp2(plan.uncovered)}</N> جنيه زيادة صرف الباقي ماغطّهاش: هتترحّل بالسالب وتتخصم من مخصص الشهر الجديد.
          </li>
        ) : null}
        {plan.debts_left > 0 ? (
          <li>
            <N>{egp2(plan.debts_left)}</N> جنيه سلف هتفضل مفتوحة للشهر الجديد.
          </li>
        ) : null}
        {data.balances.unallocated >= 0.005 ? (
          <li>
            فيه <N>{egp2(data.balances.unallocated)}</N> جنيه مستنيين التوزيع: مش داخلين في الإقفال، وزّعهم من «دخل وتوزيع».
          </li>
        ) : null}
      </ul>
      {!hasInvest ? <Notice>مفيش فئة استثمار معرّفة. أضفها من «الإعداد» علشان الباقي يروح لها.</Notice> : null}
      <div className="row row--between row--wrap">
        {undoButton ?? <span />}
        <Button
          variant="ink"
          icon={<Lock />}
          disabled={busy || !hasInvest}
          onClick={async () => {
            setBusy(true);
            await budget.post({ op: "close", cycle: plan.cycle.start });
            setBusy(false);
          }}
        >
          {busy ? "جاري الإقفال…" : "اقفل الشهر"}
        </Button>
      </div>
    </Card>
  );
}

function InvestPanel({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const accounts = data.accounts.filter((a) => !a.archived);
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(accounts.length === 1 ? String(accounts[0].id) : "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const ready = data.invest.ready;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await budget.post({ op: "invest", date: data.today, account, amount: amount || undefined });
    setBusy(false);
    if (ok) {
      setAmount("");
      setDone(true);
    }
  };

  return (
    <Card className="span-5" tone={ready >= 0.005 ? "lime" : undefined}>
      <CardHead title="جاهز للاستثمار" hint="مش بيتحوّل لوحده: أنت اللي بتأكد بعد ما تحوّل الفلوس فعلًا." />
      <div className="num num--md">
        <N>{egp2(ready)}</N>
        <small>جنيه</small>
      </div>
      {ready < 0.005 ? (
        <p className="t-small t-muted">بيتجمع هنا مخصص الاستثمار من المرتب، واللي بتوزّعه بإيدك، وباقي الشهر بعد الإقفال.</p>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          <Field label="المبلغ" optional="فاضي = كله">
            <Input type="number" inputMode="decimal" dir="ltr" min="0.01" max={ready} step="0.01" placeholder={egp2(ready)} value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label="اتحوّل من">
            <Select required value={account} onChange={(event) => setAccount(event.target.value)}>
              <option value="">اختار الحساب</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="full row row--between row--wrap">
            <span className="t-small">بيتسجل إيداع في الدفتر الحقيقي للمحفظة.</span>
            <button type="submit" className="btn btn--ink" disabled={busy}>
              {busy ? "جاري التحويل…" : "حوّل للمحفظة"}
            </button>
          </div>
        </form>
      )}
      {done ? (
        <Button variant="soft" href="/plan" arrow icon={<Coins />}>
          افتح خطة الشراء
        </Button>
      ) : null}
    </Card>
  );
}

function SpendReport({ data }: { data: BudgetView }) {
  const lines = data.report.lines.filter((line) => line.kind !== "invest");
  const totals = lines.reduce((sum, l) => ({ allocated: sum.allocated + l.allocated, spent: sum.spent + l.spent }), { allocated: 0, spent: 0 });
  return (
    <Card className="span-7">
      <CardHead title="المصروف مقابل المخصص" hint="المخصص هو اللي دخل الفئة من الدخل في الشهر ده." />
      {lines.length === 0 ? (
        <Empty icon={<CalendarCheck />} title="مفيش فئات لسه" />
      ) : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>الفئة</th>
                <th className="num-col">المخصص</th>
                <th className="num-col">المصروف</th>
                <th className="num-col">الفرق</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const diff = line.allocated - line.spent;
                return (
                  <tr key={line.category}>
                    <td>
                      <b>{line.name}</b> {line.kind === "buffer" ? <Badge tone={KIND_TONE.buffer}>{KIND_LABEL.buffer}</Badge> : null}
                      {Math.abs(line.opening) >= 0.5 ? (
                        <span className="sub">
                          مرحّل من قبله <N>{signedEgp(line.opening)}</N>
                        </span>
                      ) : null}
                    </td>
                    <td className="num-col">
                      <N>{egp(line.allocated)}</N>
                    </td>
                    <td className="num-col">
                      <N>{egp(line.spent)}</N>
                    </td>
                    <td className={cx("num-col", diff < -0.5 && "t-bad", diff > 0.5 && "t-ok")}>
                      <N>{signedEgp(diff)}</N>
                    </td>
                  </tr>
                );
              })}
              <tr className="row--total">
                <td>الإجمالي</td>
                <td className="num-col">
                  <N>{egp(totals.allocated)}</N>
                </td>
                <td className="num-col">
                  <N>{egp(totals.spent)}</N>
                </td>
                <td className="num-col">
                  <N>{signedEgp(totals.allocated - totals.spent)}</N>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function InvestRate({ data }: { data: BudgetView }) {
  const { income, invested, invest_rate: rate } = data.report;
  return (
    <Card className="span-5">
      <CardHead title="نسبة الاستثمار من الدخل" hint="اللي وصل فئة الاستثمار في الشهر ده، من المرتب والدخل الإضافي." />
      <Gauge value={(rate ?? 0) * 100}>
        <div className="num num--md">
          <N>{rate === null ? "—" : pct(rate, 0)}</N>
        </div>
        <span className="t-small t-muted">من الدخل</span>
      </Gauge>
      <div className="kv">
        <div>
          <b>
            <N>{egp(income.salary)}</N>
          </b>
          <span>المرتب</span>
        </div>
        <div>
          <b>
            <N>{egp(income.extra)}</N>
          </b>
          <span>دخل إضافي</span>
        </div>
        <div>
          <b>
            <N>{egp(invested)}</N>
          </b>
          <span>راح للاستثمار</span>
        </div>
      </div>
    </Card>
  );
}

function Incidentals({ data }: { data: BudgetView }) {
  const name = names(data);
  const items = data.entries.filter((e) => e.type === "expense" && e.incidental);
  const { incidental, loans } = data.report;
  const share = data.report.spent > 0 ? incidental.total / data.report.spent : 0;
  return (
    <Card className="span-6">
      <CardHead title="العوارض والسلف" hint="المصاريف اللي ماكانتش في الحساب، ومين استلف من مين." />
      <div className="kv">
        <div>
          <b>
            <N>{egp(incidental.total)}</N>
          </b>
          <span>
            عوارض الشهر (<N>{incidental.count}</N>)
          </span>
        </div>
        <div>
          <b>
            <N>{pct(share, 0)}</N>
          </b>
          <span>من كل المصروف</span>
        </div>
        <div>
          <b>
            <N>{egp(loans.reduce((sum, l) => sum + l.amount, 0))}</N>
          </b>
          <span>
            سلف الشهر (<N>{loans.length}</N>)
          </span>
        </div>
        <div>
          <b>
            <N>{egp(data.balances.debts.reduce((sum, d) => sum + d.amount, 0))}</N>
          </b>
          <span>سلف مفتوحة دلوقتي</span>
        </div>
      </div>
      {items.length === 0 && loans.length === 0 ? (
        <p className="t-small t-muted">مفيش عوارض ولا سلف في الشهر ده.</p>
      ) : (
        <div className="list">
          {items.map((e) => (
            <div key={e.id} className="list__row">
              <span className="list__time">
                <D>{shortDate(e.date)}</D>
              </span>
              <div className="list__main">
                <b>{e.note || "مصروف عارض"}</b>
                <span>على {name.category(e.category)}</span>
              </div>
              <b className="amt">
                <N>{egp2(e.amount)}</N>
              </b>
            </div>
          ))}
          {loans.map((l, index) => (
            <div key={`loan-${index}`} className="list__row">
              <span className="list__time">
                <D>{shortDate(l.date)}</D>
              </span>
              <div className="list__main">
                <b>
                  «{name.category(l.borrower)}» استلفت من «{name.category(l.lender)}»
                </b>
                <span>سلفة</span>
              </div>
              <b className="amt">
                <N>{egp2(l.amount)}</N>
              </b>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Trends({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const [busy, setBusy] = useState<number | null>(null);
  const withHistory = data.trends.some((t) => t.previous.length > 0);
  return (
    <Card className="span-6">
      <CardHead title="مقارنة بالشهور السابقة" hint="مصروف كل فئة قصاد متوسط آخر 3 شهور، واقتراح لما الفرق يتكرر." />
      {!withHistory ? (
        <p className="t-small t-muted">المقارنة هتظهر من تاني شهر، والاقتراحات بعد 3 شهور من التسجيل.</p>
      ) : (
        <div className="list">
          {data.trends.map((t) => {
            const diff = t.average === null ? 0 : t.spent - t.average;
            const category = data.categories.find((c) => c.id === t.category);
            return (
              <div key={t.category} className="list__row budget-trend">
                <div className="list__main">
                  <b>{t.name}</b>
                  <span>
                    صرفت <N>{egp(t.spent)}</N> · المتوسط <N>{t.average === null ? "—" : egp(t.average)}</N> · المخصص <N>{egp(t.monthly)}</N>
                  </span>
                  {t.suggestion ? (
                    <span className="t-warn">
                      {t.suggestion.reason === "over" ? "بتزيد عن المخصص كل شهر" : "بتصرف أقل من المخصص كل شهر"}: خليه <N>{egp(t.suggestion.monthly)}</N>
                    </span>
                  ) : null}
                </div>
                {t.average !== null ? (
                  <b className={cx("amt", diff > 0.5 && "t-bad", diff < -0.5 && "t-ok")}>
                    <N>{signedEgp(diff)}</N>
                  </b>
                ) : null}
                {t.suggestion && category ? (
                  <Button
                    size="sm"
                    variant="soft"
                    disabled={busy === t.category}
                    onClick={async () => {
                      setBusy(t.category);
                      await budget.post({ op: "category_save", id: category.id, name: category.name, kind: category.kind, monthly: t.suggestion?.monthly, archived: false });
                      setBusy(null);
                    }}
                  >
                    طبّق
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
