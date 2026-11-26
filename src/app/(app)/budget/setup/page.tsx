import type { Metadata } from "next";
import { BudgetSetup } from "@/features/budget/setup";

export const metadata: Metadata = { title: "إعداد الميزانية" };

export default function Page() {
  return <BudgetSetup />;
}
