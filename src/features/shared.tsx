"use client";

import { Banknote, BarChart3, Bitcoin, Building2, CircleAlert, Gem, Info, TrendingUp, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Alert, LedgerType } from "@/lib/engine";
import type { Tone } from "@/ui";

/** Each bucket keeps one tint and one icon everywhere it appears. */
export const BUCKET_TONE: Record<string, Tone | "outline"> = {
  cash: "mint",
  gold: "sand",
  index: "sky",
  active: "lilac",
  real_estate: "peach",
  crypto: "outline",
};

export function BucketIcon({ bucket }: { bucket: string }): ReactNode {
  switch (bucket) {
    case "cash":
      return <Banknote />;
    case "gold":
      return <Gem />;
    case "index":
      return <BarChart3 />;
    case "active":
      return <TrendingUp />;
    case "real_estate":
      return <Building2 />;
    case "crypto":
      return <Bitcoin />;
    default:
      return <Banknote />;
  }
}

export const ALERT_LABEL: Record<Alert["level"], string> = { action: "إجراء", warn: "تنبيه", info: "معلومة" };
export const ALERT_TONE: Record<Alert["level"], Tone | "outline"> = { action: "peach", warn: "sand", info: "sky" };

export function AlertIcon({ level }: { level: Alert["level"] }): ReactNode {
  if (level === "action") return <CircleAlert />;
  if (level === "warn") return <TriangleAlert />;
  return <Info />;
}

export const OP_LABEL: Record<LedgerType, string> = {
  deposit: "إيداع",
  withdraw: "سحب",
  buy: "شراء",
  sell: "بيع",
  income: "عائد",
  fee: "رسوم",
};

export const OP_TONE: Record<LedgerType, Tone | "outline"> = {
  deposit: "lime",
  withdraw: "peach",
  buy: "sky",
  sell: "lilac",
  income: "mint",
  fee: "sand",
};

/** Where a price reading came from, in words. */
export function sourceLabel(source: string): string {
  if (source === "trade") return "سعر عملية";
  if (source.startsWith("mark")) return "رصيد التطبيق";
  if (source.startsWith("accrue")) return "محاكاة عائد";
  if (source === "manual") return "إدخال يدوي";
  return source || "—";
}

export const REFERENCE_LABEL: Record<string, string> = {
  REF_USDEGP: "الدولار مقابل الجنيه",
  REF_XAUUSD: "أونصة الذهب عالميًا (دولار)",
  REF_GOLD24_EGP: "جرام ذهب 24 محسوب (سعر عالمي × سعر الصرف)",
  REF_BTCUSD: "بيتكوين (دولار)",
};
