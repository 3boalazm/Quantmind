import type { Metadata } from "next";
import { BudgetOverview } from "@/features/budget/overview";

export const metadata: Metadata = { title: "ميزانية الشهر" };

export default function Page() {
  return <BudgetOverview />;
}
