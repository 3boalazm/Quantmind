"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, Sun, TriangleAlert } from "lucide-react";
import { NAVIGATION } from "@/lib/navigation";
import { BOOK_LABEL, type Book } from "@/lib/types";
import { PortfolioProvider, usePortfolio } from "@/state/portfolio-provider";
import { Avatar, Button, Card, cx, Empty, IconButton, Select, Toast } from "@/ui";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <PortfolioProvider>
      <div className="app">
        <div className="frame">
          <Rail />
          <div className="main">
            <TopBar />
            <main className="page">
              <DataGate>{children}</DataGate>
            </main>
          </div>
        </div>
      </div>
      <ToastHost />
    </PortfolioProvider>
  );
}

function Rail() {
  const app = usePortfolio();
  const pathname = usePathname() ?? "/";
  const open = !app.sidebarCollapsed;
  const { setMobileOpen } = app;

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  return (
    <>
      <button
        type="button"
        className={cx("scrim", app.mobileOpen && "scrim--on")}
        aria-label="إغلاق القائمة"
        onClick={() => app.setMobileOpen(false)}
      />
      <aside className={cx("rail", open && "rail--open", app.mobileOpen && "rail--mobile-open")} aria-label="التنقل">
        <Link href="/" className="rail__brand">
          <span className="rail__logo">Q</span>
          <span className="rail__name">
            QuantMind
            <span>محفظة متوافقة مع الشريعة</span>
          </span>
        </Link>

        <nav className="rail__scroll">
          {NAVIGATION.map((section, index) => (
            <div key={section.id} className="stack stack--sm">
              {index > 0 ? <div className="rail__sep" /> : null}
              <span className="rail__section">{section.label}</span>
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="rail__item"
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label}
                  >
                    <Icon />
                    <span className="rail__label">{item.label}</span>
                    <span className="rail__tip" aria-hidden>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="rail__foot">
          <button
            type="button"
            className="rail__item"
            onClick={() => app.setTheme(app.theme === "dark" ? "light" : "dark")}
            aria-label={app.theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
          >
            {app.theme === "dark" ? <Sun /> : <Moon />}
            <span className="rail__label">{app.theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}</span>
          </button>
          <button
            type="button"
            className="rail__item rail__collapse"
            onClick={() => app.setSidebarCollapsed(open)}
            aria-label={open ? "طي القائمة" : "توسيع القائمة"}
          >
            {open ? <PanelLeftClose className="flip" /> : <PanelLeftOpen className="flip" />}
            <span className="rail__label">طي القائمة</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function TopBar() {
  const app = usePortfolio();
  return (
    <header className="topbar">
      <IconButton label="فتح القائمة" className="menu-btn" onClick={() => app.setMobileOpen(true)}>
        <Menu />
      </IconButton>

      <div className="search">
        <Search />
        <input
          type="search"
          value={app.searchQuery}
          placeholder="ابحث في العمليات والأدوات"
          aria-label="ابحث في العمليات والأدوات"
          onChange={(event) => app.setSearchQuery(event.target.value)}
        />
      </div>

      <div className="topbar__spacer" />

      <Select
        className="select--sm select--card"
        style={{ width: "auto" }}
        aria-label="الدفتر"
        value={app.book}
        onChange={(event) => app.setBook(event.target.value as Book)}
      >
        <option value="paper">{BOOK_LABEL.paper}</option>
        <option value="real">{BOOK_LABEL.real}</option>
      </Select>

      <IconButton className="topbar__lang" label="تحديث الأسعار المرجعية" onClick={() => void app.pullReference()} disabled={app.pulling}>
        <RefreshCw className={app.pulling ? "spin" : undefined} />
      </IconButton>
      <IconButton label="تسجيل الخروج" onClick={() => void app.signOut()}>
        <LogOut className="flip" />
      </IconButton>

      <div className="user-chip">
        <Avatar name="مصطفى" />
        <div className="user-chip__text">
          <b>مصطفى</b>
          <span>{BOOK_LABEL[app.book]}</span>
        </div>
      </div>
    </header>
  );
}

/** Pages render only once the first load has succeeded; before that, a quiet placeholder or the error. */
function DataGate({ children }: { children: ReactNode }) {
  const app = usePortfolio();
  if (app.data) return <>{children}</>;
  if (app.error) {
    return (
      <Card>
        <Empty
          icon={<TriangleAlert />}
          title="تعذر تحميل المحفظة"
          description={app.error}
          action={
            <Button variant="ink" onClick={() => void app.refresh()}>
              حاول تاني
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <div className="bento" aria-busy="true" aria-label="جاري التحميل">
      <div className="card card--soft skeleton span-7" style={{ minHeight: 300 }} />
      <div className="card card--soft skeleton span-5" style={{ minHeight: 300 }} />
      <div className="card card--soft skeleton span-3" style={{ minHeight: 150 }} />
      <div className="card card--soft skeleton span-3" style={{ minHeight: 150 }} />
      <div className="card card--soft skeleton span-3" style={{ minHeight: 150 }} />
      <div className="card card--soft skeleton span-3" style={{ minHeight: 150 }} />
    </div>
  );
}

function ToastHost() {
  const { toast } = usePortfolio();
  return toast ? <Toast>{toast}</Toast> : null;
}
