"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeftRight, CalendarCheck, Check, Coins, HandCoins, Hourglass, Landmark, Receipt, Scale, Trash2, Wallet, X } from "lucide-react";
import type { BudgetView, Entry } from "@/lib/budget";
import { egp, egp2, signedEgp } from "@/lib/format";
import { useBudget, type BudgetHandle } from "@/state/budget";
import { Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Notice, PageHead, Progress, Select, StatCard, Switch, cx } from "@/ui";
import { D, N } from "@/ui/text";
import { ACCOUNT_LABEL, BudgetGate, BudgetNav, KIND_LABEL, KIND_TONE, cycleLabel, describe, names, shortDate } from "./shared";

export function BudgetOverview() {
  const budget = useBudget();
  return (
    <>
      <PageHead
        eyebrow={
          <>
            <Wallet /> الميزانية
          </>
        }
        title="ميزانية الشهر"
        subtitle={budget.data ? <D>{cycleLabel(budget.data.cycle)}</D> : "دخلك متقسّم على فئات، وكل مصروف بيتخصم من فئته."}
        actions={
          <Button variant="ink" href="/budget/spend" icon={<Receipt />}>
            مصروف جديد
          </Button>
        }
      />
      <BudgetNav />
      <BudgetGate budget={budget}>{(data) => <Overview data={data} budget={budget} />}</BudgetGate>
    </>
  );
}

function Overview({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const total = Object.values(data.balances.accounts).reduce((sum, v) => sum + v, 0);
  const pending = data.pending_close;
  return (
    <div className="bento">
      {pending ? (
        <div className="span-12">
          <Notice icon={<CalendarCheck />}>
            شهر <D>{cycleLabel(pending.cycle)}</D> خلص ومستني إقفال.{" "}
            <Link href="/budget/close" className="t-ok">
              راجع الأرقام واقفله
            </Link>
          </Notice>
        </div>
      ) : null}

      <StatCard
        className="span-3"
        tone={data.balances.unallocated >= 0.5 ? "sand" : undefined}
        label="مستني التوزيع"
        value={<N>{egp(data.balances.unallocated)}</N>}
        unit="جنيه"
        icon={<Hourglass />}
        hint={data.balances.unallocated >= 0.5 ? <Link href="/budget/income">وزّعه على الفئات</Link> : "كل الدخل متوزّع"}
      />
      <StatCard className="span-3" label="اتصرف الشهر ده" value={<N>{egp(data.report.spent)}</N>} unit="جنيه" icon={<Receipt />} hint={<>منهم عوارض <N>{egp(data.report.incidental.total)}</N></>} />
      <StatCard
        className="span-3"
        tone={data.invest.ready >= 0.5 ? "lime" : undefined}
        label="جاهز للاستثمار"
        value={<N>{egp(data.invest.ready)}</N>}
        unit="جنيه"
        icon={<Coins />}
        hint={data.invest.ready >= 0.5 ? <Link href="/budget/close">حوّله للمحفظة</Link> : "بيتجمع من فئة الاستثمار وباقي الشهر"}
      />
      <StatCard className="span-3" label="كل الفلوس" value={<N>{egp(total)}</N>} unit="جنيه" icon={<Landmark />} hint="مجموع أماكن الفلوس" />

      <Categories data={data} budget={budget} />
      <Accounts data={data} budget={budget} />
      {data.balances.debts.length ? <Debts data={data} budget={budget} /> : null}
      <Entries data={data} budget={budget} />
    </div>
  );
}

function Categories({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const [open, setOpen] = useState(false);
  const active = data.categories.filter((c) => !c.archived);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [loan, setLoan] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const done = await budget.post({ op: "shift", from, to, amount, loan });
    setBusy(false);
    if (done) {
      setAmount("");
      setOpen(false);
    }
  };

  return (
    <Card className="span-7">
      <CardHead
        title="الفئات"
        hint="الباقي في كل فئة لحد دلوقتي، واللي اتصرف منها الشهر ده."
        actions={
          <Button size="sm" variant="soft" icon={<ArrowLeftRight />} onClick={() => setOpen((v) => !v)}>
            تحويل بين الفئات
          </Button>
        }
      />
      {open ? (
        <form className="form-grid" onSubmit={submit}>
          <Field label="من فئة">
            <Select required value={from} onChange={(event) => setFrom(event.target.value)}>
              <option value="">اختار</option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({egp(data.balances.categories[c.id] ?? 0)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="إلى فئة">
            <Select required value={to} onChange={(event) => setTo(event.target.value)}>
              <option value="">اختار</option>
              {active
                .filter((c) => String(c.id) !== from)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="المبلغ بالجنيه">
            <Input type="number" inputMode="decimal" dir="ltr" required min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <div className="row row--between pill-row">
            <span className="t-small grow">سلفة تترد بعدين</span>
            <Switch checked={loan} onChange={setLoan} label="سلفة تترد بعدين" />
          </div>
          <div className="full row row--between row--wrap">
            <span className="t-small t-muted">{loan ? "هتتسجل كسلفة وتفضل ظاهرة لحد ما تترد." : "تحويل نهائي: مفيش حاجة هتترد."}</span>
            <button type="submit" className="btn btn--ink" disabled={busy}>
              {busy ? "جاري الحفظ…" : loan ? "سجّل السلفة" : "حوّل"}
            </button>
          </div>
        </form>
      ) : null}
      <div className="list">
        {data.report.lines
          .filter((line) => !data.categories.find((c) => c.id === line.category)?.archived || Math.abs(line.closing) >= 0.005)
          .map((line) => {
            const balance = data.balances.categories[line.category] ?? 0;
            const available = balance + line.spent;
            const used = available > 0 ? (line.spent / available) * 100 : line.spent > 0 ? 100 : 0;
            return (
              <div key={line.category} className="list__row budget-cat">
                <div className="list__main">
                  <b>
                    {line.name} {line.kind !== "spend" ? <Badge tone={KIND_TONE[line.kind]}>{KIND_LABEL[line.kind]}</Badge> : null}
                  </b>
                  {line.kind === "invest" ? (
                    <span>بتتحول للمحفظة من شاشة الإقفال</span>
                  ) : (
                    <>
                      <Progress value={used} lime={balance >= 0} />
                      <span>
                        اتصرف <N>{egp(line.spent)}</N>
                        {available > 0.005 ? (
                          <>
                            {" "}
                            من <N>{egp(available)}</N>
                          </>
                        ) : balance < -0.005 ? (
                          " · داخلة الشهر بالسالب"
                        ) : null}
                      </span>
                    </>
                  )}
                </div>
                <div className={cx("budget-cat__left", balance < -0.005 && "t-bad")}>
                  <b>
                    <N>{balance < 0 ? signedEgp(balance) : egp(balance)}</N>
                  </b>
                  <span>{balance < -0.005 ? "زيادة صرف" : "الباقي"}</span>
                </div>
              </div>
            );
          })}
      </div>
    </Card>
  );
}

function Accounts({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const active = data.accounts.filter((a) => !a.archived);
  const [mode, setMode] = useState<"none" | "move" | "match">("none");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [actual, setActual] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);

  const expected = account ? (data.balances.accounts[Number(account)] ?? 0) : 0;
  const gap = actual === "" ? 0 : Math.round((expected - Number(actual)) * 100) / 100;

  const move = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const done = await budget.post({ op: "move", from, to, amount });
    setBusy(false);
    if (done) {
      setAmount("");
      setMode("none");
    }
  };

  const match = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const done = await budget.post({ op: "reconcile", account, actual, category: gap > 0 ? category : undefined });
    setBusy(false);
    if (done) {
      setActual("");
      setMode("none");
    }
  };

  return (
    <Card className="span-5">
      <CardHead
        title="أماكن الفلوس"
        hint="المفروض كل رصيد هنا يساوي اللي معاك فعلًا."
        actions={
          <>
            <Button size="sm" variant="soft" icon={<ArrowLeftRight />} onClick={() => setMode(mode === "move" ? "none" : "move")}>
              نقل
            </Button>
            <Button size="sm" variant="soft" icon={<Scale />} onClick={() => setMode(mode === "match" ? "none" : "match")}>
              مطابقة
            </Button>
          </>
        }
      />
      {mode === "move" ? (
        <form className="form-grid" onSubmit={move}>
          <Field label="من">
            <Select required value={from} onChange={(event) => setFrom(event.target.value)}>
              <option value="">اختار</option>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="إلى">
            <Select required value={to} onChange={(event) => setTo(event.target.value)}>
              <option value="">اختار</option>
              {active
                .filter((a) => String(a.id) !== from)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="المبلغ بالجنيه" className="full">
            <Input type="number" inputMode="decimal" dir="ltr" required min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <div className="full row row--between row--wrap">
            <span className="t-small t-muted">سحب كاش أو شحن محفظة: الفئات مابتتغيرش.</span>
            <button type="submit" className="btn btn--ink" disabled={busy}>
              {busy ? "جاري الحفظ…" : "انقل"}
            </button>
          </div>
        </form>
      ) : null}
      {mode === "match" ? (
        <form className="form-grid" onSubmit={match}>
          <Field label="الحساب">
            <Select required value={account} onChange={(event) => setAccount(event.target.value)}>
              <option value="">اختار</option>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الرصيد الفعلي دلوقتي">
            <Input type="number" inputMode="decimal" dir="ltr" required min="0" step="0.01" value={actual} onChange={(event) => setActual(event.target.value)} />
          </Field>
          {account && actual !== "" && gap > 0 ? (
            <Field label={`ناقص ${egp2(gap)} جنيه: مصروف اتنسى على فئة`} className="full">
              <Select required value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">اختار الفئة</option>
                {data.categories
                  .filter((c) => !c.archived && c.kind !== "invest")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          <div className="full row row--between row--wrap">
            <span className="t-small t-muted">
              {!account || actual === "" ? (
                "اكتب اللي معاك فعلًا، والفرق بيتسجل لوحده."
              ) : gap === 0 ? (
                "مطابق للمسجل."
              ) : gap > 0 ? (
                <>
                  المسجل <N>{egp2(expected)}</N>: الفرق هيتسجل مصروف.
                </>
              ) : (
                <>
                  فيه <N>{egp2(-gap)}</N> زيادة: هتتضاف للمبلغ المستني التوزيع.
                </>
              )}
            </span>
            <button type="submit" className="btn btn--ink" disabled={busy}>
              {busy ? "جاري الحفظ…" : "طابق"}
            </button>
          </div>
        </form>
      ) : null}
      <div className="list">
        {active.map((a) => {
          const balance = data.balances.accounts[a.id] ?? 0;
          return (
            <div key={a.id} className="list__row">
              <div className="list__main">
                <b>{a.name}</b>
                <span>{ACCOUNT_LABEL[a.kind]}</span>
              </div>
              <b className={cx("amt", balance < -0.005 && "amt--neg")}>
                <N>{egp2(balance)}</N>
              </b>
            </div>
          );
        })}
      </div>
      {active.some((a) => (data.balances.accounts[a.id] ?? 0) < -0.005) ? (
        <Notice>فيه حساب بالسالب: غالبًا مصروف اتسجل على حساب غير اللي اتدفع منه. انقل المبلغ أو اعمل مطابقة.</Notice>
      ) : null}
    </Card>
  );
}

function Debts({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const name = names(data);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card className="span-12" tone="sand">
      <CardHead title="سلف بين الفئات" hint="بتترد يدويًا، أو لوحدها عند إقفال الشهر من الباقي قبل ما أي حاجة تروح للاستثمار." />
      <div className="list">
        {data.balances.debts.map((debt) => {
          const key = `${debt.borrower}:${debt.lender}`;
          const held = data.balances.categories[debt.borrower] ?? 0;
          return (
            <div key={key} className="list__row">
              <Bubbleish />
              <div className="list__main">
                <b>
                  «{name.category(debt.borrower)}» عليها <N>{egp2(debt.amount)}</N> لـ «{name.category(debt.lender)}»
                </b>
                <span>
                  من <D>{shortDate(debt.since)}</D>
                </span>
              </div>
              <Button
                size="sm"
                variant="ink"
                disabled={busy === key || held + 0.005 < debt.amount}
                title={held + 0.005 < debt.amount ? "الفئة المدينة مافيهاش رصيد كفاية" : undefined}
                onClick={async () => {
                  setBusy(key);
                  await budget.post({ op: "repay", borrower: debt.borrower, lender: debt.lender });
                  setBusy(null);
                }}
              >
                ردّها
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Bubbleish() {
  return (
    <span className="bubble bubble--glass">
      <HandCoins />
    </span>
  );
}

export function Entries({ data, budget, limit }: { data: BudgetView; budget: BudgetHandle; limit?: number }) {
  const name = names(data);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const rows = limit ? data.entries.slice(0, limit) : data.entries;
  const closed = data.cycles.find((c) => c.start === data.selected.start)?.closed ?? false;

  const groupSize = (entry: Entry) => (entry.op ? data.entries.filter((e) => e.op === entry.op && !e.batch).length : 1);

  return (
    <Card className="span-12">
      <CardHead
        title="حركات الشهر"
        hint={
          <>
            <N>{data.entries.length}</N> حركة، الأحدث أولًا
          </>
        }
      />
      {rows.length === 0 ? (
        <Empty icon={<Receipt />} title="مفيش حركات في الشهر ده" description="سجّل المرتب من «دخل وتوزيع»، وبعدها كل مصروف وقت ما يحصل." />
      ) : (
        <div className="list">
          {rows.map((entry) => {
            const text = describe(entry, name);
            const id = entry.id as number;
            const linked = groupSize(entry) - 1;
            return (
              <div key={id} className="list__row budget-entry">
                <span className="list__time">
                  <D>{shortDate(entry.date)}</D>
                </span>
                <div className="list__main">
                  <b>
                    <Badge tone={text.tone}>{text.label}</Badge> {text.title}
                  </b>
                  <span>
                    {text.detail}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </span>
                </div>
                <b className={cx("amt", text.sign < 0 && "amt--neg", text.sign > 0 && "t-ok")}>
                  <N>{`${text.sign > 0 ? "+" : text.sign < 0 ? "−" : ""}${egp2(entry.amount)}`}</N>
                </b>
                {entry.batch || closed ? (
                  <span className="budget-entry__lock t-small t-muted">{entry.batch ? "إقفال" : ""}</span>
                ) : confirmId === id ? (
                  <span className="row">
                    <IconButton
                      size="sm"
                      variant="ink"
                      label={linked > 0 ? `تأكيد الحذف مع ${linked} حركة مرتبطة` : "تأكيد الحذف"}
                      onClick={async () => {
                        setConfirmId(null);
                        await budget.post({ op: "delete", id });
                      }}
                    >
                      <Check />
                    </IconButton>
                    <IconButton size="sm" variant="soft" label="إلغاء" onClick={() => setConfirmId(null)}>
                      <X />
                    </IconButton>
                  </span>
                ) : (
                  <IconButton size="sm" variant="soft" label="حذف الحركة" onClick={() => setConfirmId(id)}>
                    <Trash2 />
                  </IconButton>
                )}
              </div>
            );
          })}
        </div>
      )}
      {confirmId !== null ? (
        <p className="t-small t-muted">
          {(() => {
            const entry = data.entries.find((e) => e.id === confirmId);
            const linked = entry ? groupSize(entry) - 1 : 0;
            return linked > 0 ? `الحذف هياخد معاه ${linked} حركة اتسجلت في نفس العملية (زي توزيع المرتب أو السلفة اللي غطّت المصروف).` : "الحذف نهائي، والأرصدة هتتعدل.";
          })()}
        </p>
      ) : null}
    </Card>
  );
}
