import { ArrowLeftRight, Banknote, CalendarCheck, LayoutDashboard, LineChart, ListChecks, Receipt, Settings, Settings2, TrendingUp, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

/** The app is two interfaces behind one sign-in: following the investments, or following income and spending. */
export type Mode = "invest" | "budget";

export interface ModeInfo {
  label: string;
  /** Shown under the app name in the rail. */
  tagline: string;
  home: string;
  icon: LucideIcon;
  sections: NavSection[];
}

export const MODES: Record<Mode, ModeInfo> = {
  invest: {
    label: "الاستثمار",
    tagline: "محفظة متوافقة مع الشريعة",
    home: "/",
    icon: TrendingUp,
    sections: [
      {
        id: "portfolio",
        label: "المحفظة",
        items: [
          { id: "dashboard", href: "/", label: "لوحة المحفظة", icon: LayoutDashboard },
          { id: "plan", href: "/plan", label: "خطة الشراء", icon: ListChecks },
          { id: "ledger", href: "/ledger", label: "العمليات", icon: ArrowLeftRight },
          { id: "prices", href: "/prices", label: "الأسعار والأرصدة", icon: LineChart },
        ],
      },
      {
        id: "system",
        label: "النظام",
        items: [{ id: "settings", href: "/settings", label: "الإعدادات", icon: Settings }],
      },
    ],
  },
  budget: {
    label: "الدخل والمصاريف",
    tagline: "ميزانية الشهر",
    home: "/budget",
    icon: Wallet,
    sections: [
      {
        id: "budget",
        label: "الميزانية",
        items: [
          { id: "budget", href: "/budget", label: "نظرة عامة", icon: Wallet },
          { id: "budget-spend", href: "/budget/spend", label: "مصروف جديد", icon: Receipt },
          { id: "budget-income", href: "/budget/income", label: "دخل وتوزيع", icon: Banknote },
          { id: "budget-close", href: "/budget/close", label: "التقارير والإقفال", icon: CalendarCheck },
        ],
      },
      {
        id: "budget-system",
        label: "النظام",
        items: [{ id: "budget-setup", href: "/budget/setup", label: "إعداد الميزانية", icon: Settings2 }],
      },
    ],
  },
};

export const MODE_ORDER: Mode[] = ["invest", "budget"];

/** Which interface a path belongs to. */
export function modeOf(pathname: string): Mode {
  return pathname === "/budget" || pathname.startsWith("/budget/") ? "budget" : "invest";
}
