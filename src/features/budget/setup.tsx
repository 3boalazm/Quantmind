"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import type { Account, AccountKind, BudgetView, Category, CategoryKind } from "@/lib/budget";
import { egp, egp2 } from "@/lib/format";
import { useBudget, type BudgetHandle } from "@/state/budget";
import { Badge, Button, Card, CardHead, Field, IconButton, Input, Notice, PageHead, Select } from "@/ui";
import { N } from "@/ui/text";
import { ACCOUNT_LABEL, BudgetGate, BudgetNav, KIND_LABEL, KIND_TONE } from "./shared";

const KINDS: CategoryKind[] = ["spend", "buffer", "invest"];
const KIND_HELP: Record<CategoryKind, string> = {
  spend: "مصاريفك العادية. الباقي منها آخر الشهر بيروح للاستثمار.",
  buffer: "احتياطي للي بيطلع من غير حساب. رصيدها بيترحّل ومابيروحش للاستثمار.",
  invest: "اللي بيتجمع فيها بيتحوّل للمحفظة بتأكيد منك. فئة واحدة بس.",
};
const ACCOUNT_KINDS: AccountKind[] = ["bank", "cash", "wallet"];

export function BudgetSetup() {
  const budget = useBudget();
  return (
    <>
      <PageHead
        eyebrow={
          <>
            <Settings2 /> الميزانية
          </>
        }
        title="إعداد الميزانية"
        subtitle="يوم المرتب، الفئات ومبلغ كل فئة، وأماكن فلوسك. كله بيتحفظ في قاعدة بياناتك بس."
      />
      <BudgetNav />
      <BudgetGate budget={budget} setup>
        {(data) => (
          <div className="bento">
            <Steps data={data} />
            <Payday data={data} budget={budget} />
            <Accounts data={data} budget={budget} />
            <Categories data={data} budget={budget} />
          </div>
        )}
      </BudgetGate>
    </>
  );
}

function Steps({ data }: { data: BudgetView }) {
  if (data.ready && data.entries.length > 0) return null;
  const hasCategories = data.categories.some((c) => !c.archived);
  const hasAccounts = data.accounts.some((a) => !a.archived);
  const steps = [
    { done: data.payday !== null, text: "حدّد يوم نزول المرتب." },
    { done: hasAccounts, text: "أضف أماكن فلوسك: حساب البنك، الكاش، المحفظة الإلكترونية." },
    { done: hasCategories, text: "أضف فئاتك ومبلغ كل فئة من المرتب، ومعاهم فئة للعوارض وفئة للاستثمار." },
    { done: false, text: "من «دخل وتوزيع»: سجّل رصيد كل حساب كرصيد افتتاحي ووزّعه على الفئات." },
  ];
  return (
    <div className="span-12">
      <Notice block>
        <b>البداية في 4 خطوات</b>
        <ul className="checks">
          {steps.map((step) => (
            <li key={step.text} className={step.done ? "t-muted" : undefined}>
              {step.done ? "✓ " : ""}
              {step.text}
            </li>
          ))}
        </ul>
        {data.ready ? (
          <Button size="sm" variant="ink" href="/budget/income" arrow>
            سجّل الرصيد الافتتاحي
          </Button>
        ) : null}
      </Notice>
    </div>
  );
}

function Payday({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const [payday, setPayday] = useState(data.payday === null ? "" : String(data.payday));
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    await budget.post({ op: "settings_save", payday });
    setBusy(false);
  };
  return (
    <Card className="span-4">
      <CardHead title="يوم نزول المرتب" hint="الشهر المالي بيبدأ منه وبينتهي قبل المرتب اللي بعده." />
      <form className="stack" onSubmit={submit}>
        <Field label="يوم في الشهر (1 إلى 31)">
          <Input type="number" inputMode="numeric" dir="ltr" required min="1" max="31" step="1" value={payday} onChange={(event) => setPayday(event.target.value)} />
        </Field>
        <p className="t-small t-muted">لو الشهر أقصر من اليوم ده، الشهر المالي بيبدأ من آخر يوم فيه.</p>
        <button type="submit" className="btn btn--ink" disabled={busy || payday === String(data.payday ?? "")}>
          {busy ? "جاري الحفظ…" : "احفظ"}
        </button>
      </form>
    </Card>
  );
}

/** Moves one row up or down and stores the new order. */
function reorder<T extends { id: number }>(rows: T[], id: number, delta: -1 | 1): number[] | null {
  const ids = rows.map((r) => r.id);
  const index = ids.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

function Accounts({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("bank");
  const [editing, setEditing] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const done = await budget.post({ op: "account_save", name, kind });
    setBusy(false);
    if (done) setName("");
  };

  return (
    <Card className="span-8">
      <CardHead title="أماكن الفلوس" hint="كل مصروف بيتخصم من مكان، فرصيد كل مكان يفضل مطابق للي معاك." />
      <div className="list">
        {data.accounts.map((a) => {
          const balance = data.balances.accounts[a.id] ?? 0;
          if (editing?.id === a.id) {
            return (
              <form
                key={a.id}
                className="list__row budget-edit"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const done = await budget.post({ op: "account_save", id: a.id, name: editing.name, kind: editing.kind, archived: a.archived });
                  if (done) setEditing(null);
                }}
              >
                <Input className="input--sm grow" required maxLength={40} aria-label="اسم الحساب" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                <Select className="select--sm" aria-label="النوع" value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as AccountKind })}>
                  {ACCOUNT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ACCOUNT_LABEL[k]}
                    </option>
                  ))}
                </Select>
                <IconButton size="sm" variant="ink" label="حفظ" type="submit">
                  <Check />
                </IconButton>
                <IconButton size="sm" variant="soft" label="إلغاء" onClick={() => setEditing(null)}>
                  <X />
                </IconButton>
              </form>
            );
          }
          return (
            <div key={a.id} className="list__row">
              <div className="list__main">
                <b>
                  {a.name} {a.archived ? <Badge tone="outline">مؤرشف</Badge> : null}
                </b>
                <span>
                  {ACCOUNT_LABEL[a.kind]} · الرصيد <N>{egp2(balance)}</N>
                </span>
              </div>
              <RowActions
                archived={a.archived}
                onUp={() => {
                  const ids = reorder(data.accounts, a.id, -1);
                  if (ids) void budget.post({ op: "order", what: "accounts", ids });
                }}
                onDown={() => {
                  const ids = reorder(data.accounts, a.id, 1);
                  if (ids) void budget.post({ op: "order", what: "accounts", ids });
                }}
                onEdit={() => setEditing(a)}
                onArchive={() => void budget.post({ op: "account_save", id: a.id, name: a.name, kind: a.kind, archived: !a.archived })}
                onDelete={() => void budget.post({ op: "account_delete", id: a.id })}
              />
            </div>
          );
        })}
      </div>
      <form className="jline budget-add" onSubmit={add}>
        <Input className="input--sm" required maxLength={40} placeholder="اسم الحساب (مثلًا: حساب البنك)" aria-label="اسم حساب جديد" value={name} onChange={(event) => setName(event.target.value)} />
        <Select className="select--sm" aria-label="النوع" value={kind} onChange={(event) => setKind(event.target.value as AccountKind)}>
          {ACCOUNT_KINDS.map((k) => (
            <option key={k} value={k}>
              {ACCOUNT_LABEL[k]}
            </option>
          ))}
        </Select>
        <span />
        <Button type="submit" size="sm" variant="ink" icon={<Plus />} disabled={busy}>
          أضف
        </Button>
      </form>
    </Card>
  );
}

function Categories({ data, budget }: { data: BudgetView; budget: BudgetHandle }) {
  const [name, setName] = useState("");
  const [monthly, setMonthly] = useState("");
  const [kind, setKind] = useState<CategoryKind>("spend");
  const [editing, setEditing] = useState<(Omit<Category, "monthly"> & { monthly: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  const active = data.categories.filter((c) => !c.archived);
  const total = active.reduce((sum, c) => sum + c.monthly, 0);
  const hasInvest = active.some((c) => c.kind === "invest");
  const hasBuffer = active.some((c) => c.kind === "buffer");

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const done = await budget.post({ op: "category_save", name, monthly, kind });
    setBusy(false);
    if (done) {
      setName("");
      setMonthly("");
      setKind("spend");
    }
  };

  return (
    <Card className="span-12">
      <CardHead
        title="الفئات"
        hint="المبلغ هو نصيب الفئة من كل مرتب. الترتيب هو ترتيب التوزيع لو المرتب ماكفّاش."
        actions={
          <Badge tone="outline">
            مجموع المبالغ <N>{egp(total)}</N>
          </Badge>
        }
      />
      {!hasInvest || !hasBuffer ? (
        <Notice>
          {!hasInvest ? "ناقص فئة من نوع «استثمار»: هي اللي بيروح لها باقي الشهر وبتتحول منها الفلوس للمحفظة. " : ""}
          {!hasBuffer ? "ومفيش فئة «عوارض»: اختيارية، بس هي اللي بتشيل اللي بيطلع من غير حساب." : ""}
        </Notice>
      ) : null}
      <div className="list">
        {data.categories.map((c) => {
          const balance = data.balances.categories[c.id] ?? 0;
          if (editing?.id === c.id) {
            return (
              <form
                key={c.id}
                className="list__row budget-edit"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const done = await budget.post({ op: "category_save", id: c.id, name: editing.name, monthly: editing.monthly, kind: editing.kind, archived: c.archived });
                  if (done) setEditing(null);
                }}
              >
                <Input className="input--sm grow" required maxLength={40} aria-label="اسم الفئة" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                <Input
                  className="input--sm input--mini"
                  type="number"
                  inputMode="decimal"
                  dir="ltr"
                  min="0"
                  step="0.01"
                  aria-label="المبلغ الشهري"
                  value={editing.monthly}
                  onChange={(event) => setEditing({ ...editing, monthly: event.target.value })}
                />
                <Select className="select--sm" aria-label="النوع" value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as CategoryKind })}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
                <IconButton size="sm" variant="ink" label="حفظ" type="submit">
                  <Check />
                </IconButton>
                <IconButton size="sm" variant="soft" label="إلغاء" onClick={() => setEditing(null)}>
                  <X />
                </IconButton>
              </form>
            );
          }
          return (
            <div key={c.id} className="list__row">
              <div className="list__main">
                <b>
                  {c.name} <Badge tone={KIND_TONE[c.kind]}>{KIND_LABEL[c.kind]}</Badge> {c.archived ? <Badge tone="outline">مؤرشفة</Badge> : null}
                </b>
                <span>
                  من كل مرتب <N>{egp(c.monthly)}</N> · فيها دلوقتي <N>{egp2(balance)}</N>
                </span>
              </div>
              <RowActions
                archived={c.archived}
                onUp={() => {
                  const ids = reorder(data.categories, c.id, -1);
                  if (ids) void budget.post({ op: "order", what: "categories", ids });
                }}
                onDown={() => {
                  const ids = reorder(data.categories, c.id, 1);
                  if (ids) void budget.post({ op: "order", what: "categories", ids });
                }}
                onEdit={() => setEditing({ ...c, monthly: String(c.monthly) })}
                onArchive={() => void budget.post({ op: "category_save", id: c.id, name: c.name, monthly: c.monthly, kind: c.kind, archived: !c.archived })}
                onDelete={() => void budget.post({ op: "category_delete", id: c.id })}
              />
            </div>
          );
        })}
      </div>
      <form className="jline budget-add" onSubmit={add}>
        <Input className="input--sm" required maxLength={40} placeholder="اسم الفئة" aria-label="اسم فئة جديدة" value={name} onChange={(event) => setName(event.target.value)} />
        <Input className="input--sm" type="number" inputMode="decimal" dir="ltr" min="0" step="0.01" placeholder="المبلغ من كل مرتب" aria-label="المبلغ من كل مرتب" value={monthly} onChange={(event) => setMonthly(event.target.value)} />
        <Select className="select--sm" aria-label="النوع" value={kind} onChange={(event) => setKind(event.target.value as CategoryKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k} disabled={k === "invest" && hasInvest}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="ink" icon={<Plus />} disabled={busy}>
          أضف
        </Button>
      </form>
      <p className="t-small t-muted">{KIND_HELP[kind]}</p>
    </Card>
  );
}

function RowActions({
  archived,
  onUp,
  onDown,
  onEdit,
  onArchive,
  onDelete,
}: {
  archived: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="row budget-actions">
      <IconButton size="sm" variant="soft" label="لفوق" onClick={onUp}>
        <ArrowUp />
      </IconButton>
      <IconButton size="sm" variant="soft" label="لتحت" onClick={onDown}>
        <ArrowDown />
      </IconButton>
      <IconButton size="sm" variant="soft" label="تعديل" onClick={onEdit}>
        <Pencil />
      </IconButton>
      <IconButton size="sm" variant="soft" label={archived ? "تفعيل" : "أرشفة"} onClick={onArchive}>
        {archived ? <ArchiveRestore /> : <Archive />}
      </IconButton>
      <IconButton size="sm" variant="soft" label="حذف (لو مفيش عليها حركات)" onClick={onDelete}>
        <Trash2 />
      </IconButton>
    </span>
  );
}
