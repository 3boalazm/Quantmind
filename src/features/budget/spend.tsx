"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import type { BudgetView } from "@/lib/budget";
import { egp, egp2 } from "@/lib/format";
import { useBudget, type BudgetHandle } from "@/state/budget";
import { Button, Card, CardHead, Field, Input, Notice, PageHead, Select, Switch, cx } from "@/ui";
import { N } from "@/ui/text";
import { Entries } from "./overview";
import { BudgetGate, BudgetNav } from "./shared";

const LAST_ACCOUNT = "quantmind:budget-account";

export function BudgetSpend() {
  const budget = useBudget();
  return (
    <>
      <PageHead
        eyebrow={
          <>
            <Receipt /> الميزانية
          </>
        }
        title="مصروف جديد"
        subtitle="سجّله وقت ما يحصل: المبلغ، الفئة، ومنين اتدفع."
      />
      <BudgetNav />
      <BudgetGate budget={budget}>{(data) => <Spend data={data} budget={budget} />}</BudgetGate>
    </>
  );
}

function Spend({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const categories = data.categories.filter((c) => !c.archived && c.kind !== "invest");
  const accounts = data.accounts.filter((a) => !a.archived);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<number | null>(null);
  const [account, setAccount] = useState<number | null>(accounts.length === 1 ? accounts[0].id : null);
  const [incidental, setIncidental] = useState(false);
  const [borrow, setBorrow] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(data.today);
  const [busy, setBusy] = useState(false);

  // The account used last time is the likeliest one this time.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(LAST_ACCOUNT));
      if (saved && accounts.some((a) => a.id === saved)) setAccount(saved);
    } catch {
      // storage unavailable: nothing is preselected
    }
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const held = category === null ? 0 : (data.balances.categories[category] ?? 0);
  const value = Number(amount) || 0;
  const short = category === null ? 0 : Math.round((value - Math.max(0, held)) * 100) / 100;
  const lenders = categories.filter((c) => c.id !== category && (data.balances.categories[c.id] ?? 0) + 0.005 >= short);
  const picked = categories.find((c) => c.id === category);

  // A lender chosen for one shortfall may not cover the next one.
  useEffect(() => {
    if (short <= 0 || (borrow && !lenders.some((c) => String(c.id) === borrow))) setBorrow("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [short, category]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || category === null || account === null) return;
    setBusy(true);
    const done = await budget.post({
      op: "expense",
      date,
      amount,
      category,
      account,
      incidental: incidental || picked?.kind === "buffer",
      borrow_from: short > 0 && borrow ? borrow : undefined,
      note,
    });
    setBusy(false);
    if (done) {
      try {
        window.localStorage.setItem(LAST_ACCOUNT, String(account));
      } catch {
        // ignore
      }
      setAmount("");
      setNote("");
      setBorrow("");
      setIncidental(false);
    }
  };

  return (
    <div className="bento">
      <Card className="span-6">
        <form className="stack budget-spend" onSubmit={submit}>
          <Field label="المبلغ بالجنيه">
            <Input
              className="input--hero"
              type="number"
              inputMode="decimal"
              dir="ltr"
              required
              min="0.01"
              step="0.01"
              placeholder="0"
              autoFocus
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>

          <div className="stack stack--sm">
            <span className="field__label" id="spend-category">
              الفئة
            </span>
            <div className="choices" role="group" aria-labelledby="spend-category">
              {categories.map((c) => {
                const balance = data.balances.categories[c.id] ?? 0;
                return (
                  <button key={c.id} type="button" className={cx("choice", "budget-choice")} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
                    {c.name}
                    <small className={balance < -0.005 ? "t-bad" : undefined}>
                      <N>{egp(balance)}</N>
                    </small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="stack stack--sm">
            <span className="field__label" id="spend-account">
              اتدفع من
            </span>
            <div className="choices" role="group" aria-labelledby="spend-account">
              {accounts.map((a) => (
                <button key={a.id} type="button" className="choice" aria-pressed={account === a.id} onClick={() => setAccount(a.id)}>
                  {a.name}
                </button>
              ))}
            </div>
          </div>

          {category !== null && value > 0 && short > 0 ? (
            <Notice block>
              «{picked?.name}» فيها <N>{egp2(Math.max(0, held))}</N> والمصروف <N>{egp2(value)}</N>: ناقص <N>{egp2(short)}</N> جنيه.
              <Field label="الناقص يتغطى من">
                <Select value={borrow} onChange={(event) => setBorrow(event.target.value)}>
                  <option value="">من غير سلفة (الفئة تبقى بالسالب)</option>
                  {lenders.map((c) => (
                    <option key={c.id} value={c.id}>
                      سلفة من {c.name} ({egp(data.balances.categories[c.id] ?? 0)})
                    </option>
                  ))}
                </Select>
              </Field>
            </Notice>
          ) : null}

          {picked?.kind === "buffer" ? null : (
            <div className="row row--between pill-row">
              <span className="t-small grow">مصروف عارض ماكانش في الحساب</span>
              <Switch checked={incidental} onChange={setIncidental} label="مصروف عارض" />
            </div>
          )}

          <div className="form-grid">
            <Field label="ملاحظة" optional="اختياري">
              <Input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <Field label="التاريخ">
              <Input type="date" dir="ltr" required max={data.today} value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          </div>

          <Button type="submit" variant="ink" className="budget-submit" disabled={busy || category === null || account === null || !(value > 0)}>
            {busy ? "جاري الحفظ…" : category === null ? "اختار الفئة" : account === null ? "اختار منين اتدفع" : "سجّل المصروف"}
          </Button>
        </form>
      </Card>

      <div className="span-6 stack">
        <Card tone="soft">
          <CardHead title="الباقي في الفئات" hint="بيتحدّث بعد كل مصروف." />
          <div className="kv">
            {categories.map((c) => {
              const balance = data.balances.categories[c.id] ?? 0;
              return (
                <div key={c.id}>
                  <b className={balance < -0.005 ? "t-bad" : undefined}>
                    <N>{egp(balance)}</N>
                  </b>
                  <span>{c.name}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Entries data={data} budget={budget} limit={8} />
    </div>
  );
}
