import type { Metadata } from "next";
import { BudgetClose } from "@/features/budget/close";

export const metadata: Metadata = { title: "التقارير والإقفال" };

export default function Page() {
  return <BudgetClose />;
}
