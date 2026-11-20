import type { Metadata } from "next";
import { LedgerScreen } from "@/features/ledger";

export const metadata: Metadata = { title: "العمليات" };

export default function Page() {
  return <LedgerScreen />;
}
