import type { Metadata } from "next";
import { FollowUpScreen } from "@/features/follow-up";

export const metadata: Metadata = { title: "المتابعة" };

export default function Page() {
  return <FollowUpScreen />;
}
