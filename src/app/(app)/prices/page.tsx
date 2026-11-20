import type { Metadata } from "next";
import { PricesScreen } from "@/features/prices";

export const metadata: Metadata = { title: "الأسعار والأرصدة" };

export default function Page() {
  return <PricesScreen />;
}
