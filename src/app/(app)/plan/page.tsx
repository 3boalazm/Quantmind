import type { Metadata } from "next";
import { PlanScreen } from "@/features/plan";

export const metadata: Metadata = { title: "خطة الشراء" };

export default function Page() {
  return <PlanScreen />;
}
