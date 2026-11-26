"use client";

import { useMemo, useState } from "react";
import { Banknote, Hourglass } from "lucide-react";
import { planSalary, type BudgetView, type IncomeSource } from "@/lib/budget";
import { egp, egp2 } from "@/lib/format";
import { useBudget, type BudgetHandle } from "@/state/budget";
import { Badge, Button, Card, CardHead, Empty, Field, Input, Notice, PageHead, Select, Switch, Tabs } from "@/ui";
import { N } from "@/ui/text";
import { BudgetGate, BudgetNav, KIND_LABEL, KIND_TONE } from "./shared";

type Source = Extract<IncomeSource, "salary" | "extra" | "opening">;

const SOURCES: Array<{ value: Source; label: string }> = [
  { value: "salary", label: "المرتب" },
  { value: "extra", label: "دخل إضافي" },
  { value: "opening", label: "رصيد افتتاحي" },
];

const HELP: Record<Source, string> = {
  salary: "بيتوزّع على الفئات بمبالغها الثابتة، واللي يزيد بيستنى توزيعك.",
  extra: "شغل حر، مكافأة، أي دخل غير المرتب. بيستنى لحد ما تقرر يروح فين.",
  opening: "الفلوس اللي معاك دلوقتي قبل ما تبدأ. سجّل رصيد كل حساب مرة واحدة، وبعدين وزّعه.",
};

export function BudgetIncome() {
  const budget = useBudget();
  return (
    <>
      <PageHead
        eyebrow={
          <>
            <Banknote /> الميزانية
          </>
        }
        title="دخل وتوزيع"
        subtitle="سجّل اللي دخل، ووزّع أي مبلغ مستني على الفئات."
      />
      <BudgetNav />
      <BudgetGate budget={budget}>
        {(data) => (
          <div className="bento">
            <IncomeForm data={data} budget={budget} />
            <Distribute data={data} budget={budget} />
          </div>
        )}
      </BudgetGate>
    </>
  );
}

function IncomeForm({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const accounts = data.accounts.filter((a) => !a.archived);
  const hasEntries = data.cycles.length > 1 || data.entries.length > 0;
  const [source, setSource] = useState<Source>(hasEntries ? "salary" : "opening");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(accounts.length === 1 ? String(accounts[0].id) : "");
  const [date, setDate] = useState(data.today);
  const [note, setNote] = useState("");
  const [distribute, setDistribute] = useState(true);
  const [fundBuffer, setFundBuffer] = useState(true);
  const [busy, setBusy] = useState(false);

  const value = Number(amount) || 0;
  const hasBuffer = data.categories.some((c) => !c.archived && c.kind === "buffer" && c.monthly > 0);
  const plan = useMemo(() => planSalary(data.categories, value, fundBuffer), [data.categories, fundBuffer, value]);
  const nameOf = (id: number) => data.categories.find((c) => c.id === id);
  const fixedTotal = data.categories.filter((c) => !c.archived).reduce((sum, c) => sum + c.monthly, 0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const done = await budget.post({ op: "income", date, amount, account, source, note, distribute: source === "salary" ? distribute : undefined, fund_buffer: fundBuffer });
    setBusy(false);
    if (done) {
      setAmount("");
      setNote("");
    }
  };

  return (
    <Card className="span-6">
      <CardHead title="تسجيل دخل" hint={HELP[source]} />
      <Tabs filled label="نوع الدخل" value={source} options={SOURCES} onChange={setSource} />
      <form className="form-grid" onSubmit={submit}>
        <Field label="المبلغ بالجنيه">
          <Input type="number" inputMode="decimal" dir="ltr" required min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label="دخل على">
          <Select required value={account} onChange={(event) => setAccount(event.target.value)}>
            <option value="">اختار الحساب</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="التاريخ">
          <Input type="date" dir="ltr" required max={data.today} value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="ملاحظة" optional="اختياري">
          <Input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>

        {source === "salary" ? (
          <>
            <div className="row row--between pill-row full">
              <span className="t-small grow">وزّعه على الفئات بمبالغها الثابتة</span>
              <Switch checked={distribute} onChange={setDistribute} label="توزيع المرتب تلقائيًا" />
            </div>
            {distribute && hasBuffer ? (
              <div className="row row--between pill-row full">
                <span className="t-small grow">موّل فئة العوارض الشهر ده</span>
                <Switch checked={fundBuffer} onChange={setFundBuffer} label="تمويل العوارض الشهر ده" />
              </div>
            ) : null}
            {distribute && value > 0 ? (
              <div className="full stack">
                {fixedTotal === 0 ? (
                  <Notice>مفيش مبالغ ثابتة على الفئات، فالمرتب كله هيستنى التوزيع. حدّد المبالغ من «الإعداد».</Notice>
                ) : (
                  <div className="stmt">
                    {plan.allocations.map((a) => (
                      <div key={a.category} className="stmt__row">
                        <span>{nameOf(a.category)?.name}</span>
                        <b className="amt">
                          <N>{egp2(a.amount)}</N>
                        </b>
                      </div>
                    ))}
                    <div className="stmt__row stmt__row--total">
                      <span>يفضل مستني التوزيع</span>
                      <b className="amt">
                        <N>{egp2(plan.remaining)}</N>
                      </b>
                    </div>
                  </div>
                )}
                {plan.short.length ? (
                  <Notice>
                    المرتب مايكفّيش كل الفئات: ناقص <N>{egp(plan.short.reduce((sum, s) => sum + s.amount, 0))}</N> جنيه في{" "}
                    {plan.short.map((s) => `«${nameOf(s.category)?.name}»`).join("، ")}.
                  </Notice>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="full row row--between row--wrap">
          <span className="t-small t-muted">
            مستني التوزيع دلوقتي: <N>{egp2(data.balances.unallocated)}</N> جنيه
          </span>
          <button type="submit" className="btn btn--ink" disabled={busy}>
            {busy ? "جاري الحفظ…" : source === "salary" ? "سجّل المرتب" : "سجّل الدخل"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Distribute({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const waiting = data.balances.unallocated;
  const categories = data.categories.filter((c) => !c.archived);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const total = Object.values(amounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const left = Math.round((waiting - total) * 100) / 100;

  const set = (id: number, value: string) => setAmounts((current) => ({ ...current, [id]: value }));
  /** Puts whatever is still undistributed into one category. */
  const fill = (id: number) => {
    const own = Number(amounts[id]) || 0;
    const rest = Math.round((left + own) * 100) / 100;
    if (rest > 0) set(id, String(rest));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const items = categories.filter((c) => Number(amounts[c.id]) > 0).map((c) => ({ category: c.id, amount: amounts[c.id] }));
    const done = await budget.post({ op: "allocate", date: data.today, items });
    setBusy(false);
    if (done) setAmounts({});
  };

  return (
    <Card className="span-6" tone={waiting >= 0.005 ? "sand" : undefined}>
      <CardHead
        title="توزيع المبلغ المستني"
        hint="أنت اللي بتقرر كل مرة: كله لفئة واحدة أو متقسّم."
        actions={
          <Badge tone={left < -0.005 ? "peach" : "outline"}>
            فاضل <N>{egp2(left)}</N>
          </Badge>
        }
      />
      {waiting < 0.005 ? (
        <Empty icon={<Hourglass />} title="مفيش مبلغ مستني توزيع" description="أي دخل إضافي أو زيادة من المرتب هتظهر هنا." />
      ) : (
        <form className="stack" onSubmit={submit}>
          <div className="list">
            {categories.map((c) => (
              <div key={c.id} className="list__row">
                <div className="list__main">
                  <b>
                    {c.name} {c.kind !== "spend" ? <Badge tone={KIND_TONE[c.kind]}>{KIND_LABEL[c.kind]}</Badge> : null}
                  </b>
                  <span>
                    فيها دلوقتي <N>{egp(data.balances.categories[c.id] ?? 0)}</N>
                  </span>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => fill(c.id)} disabled={left <= 0}>
                  الباقي كله
                </Button>
                <Input
                  className="input--mini input--sm"
                  type="number"
                  inputMode="decimal"
                  dir="ltr"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  aria-label={`مبلغ ${c.name}`}
                  value={amounts[c.id] ?? ""}
                  onChange={(event) => set(c.id, event.target.value)}
                />
              </div>
            ))}
          </div>
          {left < -0.005 ? <Notice>المجموع أكبر من المبلغ المستني بـ {egp2(-left)} جنيه.</Notice> : null}
          <div className="row row--between row--wrap">
            <span className="t-small t-muted">
              المستني <N>{egp2(waiting)}</N> · هتوزّع <N>{egp2(total)}</N>
            </span>
            <button type="submit" className="btn btn--ink" disabled={busy || total <= 0 || left < -0.005}>
              {busy ? "جاري الحفظ…" : "وزّع"}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
