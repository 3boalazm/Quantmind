import type { Metadata } from "next";
import { BudgetSpend } from "@/features/budget/spend";

export const metadata: Metadata = { title: "مصروف جديد" };

export default function Page() {
  return <BudgetSpend />;
}
