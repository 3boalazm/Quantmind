"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, Sun, TriangleAlert } from "lucide-react";
import { MODE_ORDER, MODES, modeOf, type Mode } from "@/lib/navigation";
import { BOOK_LABEL, type Book } from "@/lib/types";
import { PortfolioProvider, usePortfolio } from "@/state/portfolio-provider";
import { Avatar, Button, Card, cx, Empty, IconButton, Select, Toast } from "@/ui";
import { Mixed } from "@/ui/text";

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
      <ModeMemory />
      <ConfirmHost />
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

  const mode = MODES[modeOf(pathname)];
  // The most specific entry wins, so "/budget/spend" does not also light up "/budget".
  const activeHref = mode.sections.flatMap((section) => section.items)
    .map((item) => item.href)
    .filter((href) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <>
      <button
        type="button"
        className={cx("scrim", app.mobileOpen && "scrim--on")}
        aria-label="إغلاق القائمة"
        onClick={() => app.setMobileOpen(false)}
      />
      <aside className={cx("rail", open && "rail--open", app.mobileOpen && "rail--mobile-open")} aria-label="التنقل">
        <Link href={mode.home} className="rail__brand">
          <span className="rail__logo">Q</span>
          <span className="rail__name">
            QuantMind
            <span>{mode.tagline}</span>
          </span>
        </Link>

        <nav className="rail__scroll">
          {mode.sections.map((section, index) => (
            <div key={section.id} className="stack stack--sm">
              {index > 0 ? <div className="rail__sep" /> : null}
              <span className="rail__section">{section.label}</span>
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = item.href === activeHref;
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

const MODE_KEY = "quantmind:mode";

/**
 * Opens the app where it was last used: someone who came in for the budget last time lands on the
 * budget again. Only the very first page view is redirected; after that the switch decides.
 */
function ModeMemory() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const first = useRef(true);
  useEffect(() => {
    try {
      if (first.current) {
        first.current = false;
        if (pathname === "/" && !window.location.search && window.localStorage.getItem(MODE_KEY) === "budget") {
          router.replace(MODES.budget.home);
          return;
        }
      }
      window.localStorage.setItem(MODE_KEY, modeOf(pathname));
    } catch {
      // storage unavailable: the app simply opens on the portfolio
    }
  }, [pathname, router]);
  return null;
}

/** The two interfaces side by side; the dark pill slides to the one on screen. */
function ModeSwitch({ mode }: { mode: Mode }) {
  return (
    <nav className="mode-switch" data-mode={mode} aria-label="الواجهة">
      {MODE_ORDER.map((id) => {
        const item = MODES[id];
        const Icon = item.icon;
        return (
          <Link key={id} href={item.home} aria-current={id === mode ? "true" : undefined}>
            <Icon />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function TopBar() {
  const app = usePortfolio();
  const mode = modeOf(usePathname() ?? "/");
  const investing = mode === "invest";
  return (
    <header className="topbar">
      <IconButton label="فتح القائمة" className="menu-btn" onClick={() => app.setMobileOpen(true)}>
        <Menu />
      </IconButton>

      <ModeSwitch mode={mode} />

      {investing ? (
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
      ) : null}

      <div className="topbar__spacer" />

      {/* The book and the reference prices belong to the portfolio; the budget follows real money only. */}
      {investing ? (
        <>
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
        </>
      ) : null}
      <IconButton className={investing ? undefined : "topbar__lang"} label="تسجيل الخروج" onClick={() => void app.signOut()}>
        <LogOut className="flip" />
      </IconButton>

      <div className="user-chip">
        <Avatar name="مصطفى" />
        <div className="user-chip__text">
          <b>مصطفى</b>
          <span>{investing ? BOOK_LABEL[app.book] : MODES.budget.label}</span>
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

/** Asks before storing an entry the server flagged as unusual. */
function ConfirmHost() {
  const { pending, answerPending } = usePortfolio();
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") answerPending(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answerPending, pending]);
  if (!pending) return null;
  return (
    <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
      <Card className="modal__panel">
        <div className="row">
          <span className="bubble">
            <TriangleAlert />
          </span>
          <h2 id="confirm-title" className="t-title">
            راجع الرقم قبل الحفظ
          </h2>
        </div>
        <p id="confirm-text" className="t-label" style={{ lineHeight: 1.7 }}>
          <Mixed text={pending.message} />
        </p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => answerPending(false)}>
            رجوع للتصحيح
          </Button>
          <Button variant="ink" onClick={() => answerPending(true)}>
            الرقم صح، احفظ
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ToastHost() {
  const { toast } = usePortfolio();
  return toast ? <Toast>{toast}</Toast> : null;
}
