"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { AccountKind, BudgetView, CategoryKind, Cycle, Entry } from "@/lib/budget";
import { formatDate } from "@/lib/format";
import type { BudgetHandle } from "@/state/budget";
import { Button, Card, Empty, type Tone } from "@/ui";

export const KIND_LABEL: Record<CategoryKind, string> = { spend: "صرف", buffer: "عوارض", invest: "استثمار" };
export const KIND_TONE: Record<CategoryKind, Tone | "outline"> = { spend: "outline", buffer: "sand", invest: "lime" };
export const ACCOUNT_LABEL: Record<AccountKind, string> = { bank: "بنك", cash: "كاش", wallet: "محفظة إلكترونية" };

const SECTIONS = [
  { href: "/budget", label: "نظرة عامة" },
  { href: "/budget/spend", label: "مصروف" },
  { href: "/budget/income", label: "دخل وتوزيع" },
  { href: "/budget/close", label: "التقارير والإقفال" },
  { href: "/budget/setup", label: "الإعداد" },
];

export function BudgetNav() {
  const pathname = usePathname() ?? "";
  return (
    // On a wide screen the rail already lists these; on a phone the rail is a drawer, so they sit here.
    <nav className="subnav subnav--phone" aria-label="أقسام الميزانية">
      {SECTIONS.map((item) => (
        <Link key={item.href} href={item.href} className="subnav__item" aria-current={pathname === item.href ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Day and month, and the year only when it differs from this one. */
export function shortDate(value: string): string {
  return formatDate(value, { day: "numeric", month: "short" });
}

export function cycleLabel(cycle: Cycle): string {
  return `${shortDate(cycle.start)} – ${formatDate(cycle.end)}`;
}

/**
 * Waits for the budget, and sends a budget that is not set up yet to the setup screen.
 * `setup` is the setup screen itself, which must render either way.
 */
export function BudgetGate({ budget, setup, children }: { budget: BudgetHandle; setup?: boolean; children: (data: BudgetView) => ReactNode }) {
  if (budget.error && !budget.data) {
    return (
      <Card>
        <Empty
          icon={<TriangleAlert />}
          title="تعذر تحميل الميزانية"
          description={budget.error}
          action={
            <Button variant="ink" onClick={() => void budget.reload()}>
              حاول تاني
            </Button>
          }
        />
      </Card>
    );
  }
  if (!budget.data) {
    return (
      <div className="bento" aria-busy="true" aria-label="جاري التحميل">
        <div className="card card--soft skeleton span-7" style={{ minHeight: 260 }} />
        <div className="card card--soft skeleton span-5" style={{ minHeight: 260 }} />
      </div>
    );
  }
  if (!budget.data.ready && !setup) {
    return (
      <Card>
        <Empty
          icon={<Settings2 />}
          title="الميزانية لسه ماتجهزتش"
          description="عرّف يوم نزول المرتب، وفئاتك ومبلغ كل فئة، وأماكن فلوسك. بياخد دقيقتين، وبعدها كل حاجة بتتحسب لوحدها."
          action={
            <Button variant="ink" href="/budget/setup" arrow>
              ابدأ الإعداد
            </Button>
          }
        />
      </Card>
    );
  }
  return <>{children(budget.data)}</>;
}

export function names(data: BudgetView) {
  const categories = new Map(data.categories.map((c) => [c.id, c.name]));
  const accounts = new Map(data.accounts.map((a) => [a.id, a.name]));
  return {
    category: (id: number | null) => (id === null ? "—" : (categories.get(id) ?? "فئة محذوفة")),
    account: (id: number | null) => (id === null ? "—" : (accounts.get(id) ?? "حساب محذوف")),
  };
}

const SOURCE_LABEL: Record<string, string> = { salary: "مرتب", extra: "دخل إضافي", opening: "رصيد افتتاحي", reconcile: "زيادة عن المسجل" };

export interface EntryText {
  title: string;
  detail: string;
  /** +1 money in, −1 money out, 0 a move inside the budget. */
  sign: 1 | -1 | 0;
  tone: Tone | "outline";
  label: string;
}

/** One line of the budget in words. */
export function describe(entry: Entry, name: ReturnType<typeof names>): EntryText {
  switch (entry.type) {
    case "income":
      return { label: "دخل", tone: "mint", sign: 1, title: SOURCE_LABEL[entry.source] ?? "دخل", detail: `دخل ${name.account(entry.account)}` };
    case "allocate":
      return { label: "توزيع", tone: "sky", sign: 0, title: name.category(entry.to_category), detail: "من المبلغ المستني التوزيع" };
    case "expense":
      return {
        label: entry.reconcile ? "مطابقة" : entry.incidental ? "عارض" : "مصروف",
        tone: entry.incidental || entry.reconcile ? "peach" : "outline",
        sign: -1,
        title: name.category(entry.category),
        detail: `من ${name.account(entry.account)}`,
      };
    case "transfer":
      return { label: "تحويل", tone: "sky", sign: 0, title: `${name.category(entry.category)} ← ${name.category(entry.to_category)}`, detail: "بين الفئات" };
    case "loan":
      return { label: "سلفة", tone: "sand", sign: 0, title: `${name.category(entry.to_category)} استلفت من ${name.category(entry.category)}`, detail: "تترد لاحقًا" };
    case "repay":
      return { label: "رد سلفة", tone: "sand", sign: 0, title: `${name.category(entry.category)} ردّت لـ ${name.category(entry.to_category)}`, detail: "سداد" };
    case "move":
      return { label: "نقل", tone: "outline", sign: 0, title: `${name.account(entry.account)} ← ${name.account(entry.to_account)}`, detail: "بين الحسابات" };
    case "invest":
      return { label: "استثمار", tone: "lime", sign: -1, title: "تحويل للمحفظة", detail: `من ${name.account(entry.account)}` };
  }
}
