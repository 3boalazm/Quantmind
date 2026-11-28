import type { Metadata } from "next";
import { LabScreen } from "@/features/lab";

export const metadata: Metadata = { title: "دفاتر الكريبتو التجريبية" };

export default function Page() {
  return <LabScreen />;
}
