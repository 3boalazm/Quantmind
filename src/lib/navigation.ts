import { ArrowLeftRight, LayoutDashboard, LineChart, ListChecks, Settings, type LucideIcon } from "lucide-react";

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

export const NAVIGATION: NavSection[] = [
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
];
