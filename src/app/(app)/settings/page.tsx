import type { Metadata } from "next";
import { SettingsScreen } from "@/features/settings";

export const metadata: Metadata = { title: "الإعدادات" };

export default function Page() {
  return <SettingsScreen />;
}
