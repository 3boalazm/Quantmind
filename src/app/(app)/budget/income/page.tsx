import type { Metadata } from "next";
import { BudgetIncome } from "@/features/budget/income";

export const metadata: Metadata = { title: "دخل وتوزيع" };

export default function Page() {
  return <BudgetIncome />;
}
