"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { Book, StateResponse } from "@/lib/types";

type ThemeMode = "light" | "dark";

interface PortfolioContextValue {
  theme: ThemeMode;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  book: Book;
  setBook: (book: Book) => void;
  /** Money you plan to deposit now; `null` lets the server pick (the monthly amount, unless cash is already waiting). */
  add: number | null;
  setAdd: (value: number | null) => void;
  data: StateResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /**
   * Calls a write endpoint, reloads the data and shows the outcome as a toast. Resolves to true on success.
   * `also` reloads whatever else the screen shows; the toast waits for it, so the message never
   * appears while the figures on screen are still the old ones.
   */
  send: (method: "POST" | "PUT" | "DELETE", url: string, body?: unknown, also?: () => Promise<unknown>) => Promise<boolean>;
  toast: string | null;
  notify: (message: string) => void;
  /** An entry the server wants confirmed (a price far from the last reading). */
  pending: PendingConfirm | null;
  answerPending: (accept: boolean) => void;
  /** Pulls the public reference prices now. The last outcome stays available for the prices screen. */
  pullReference: () => Promise<void>;
  pulling: boolean;
  fetchReport: FetchReport | null;
  signOut: () => Promise<void>;
}

export interface PendingConfirm {
  message: string;
}

export interface FetchReport {
  ok: string[];
  failed: Record<string, string>;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [book, setBookState] = useState<Book>("paper");
  const [add, setAddState] = useState<number | null>(null);
  const [data, setData] = useState<StateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetchReport, setFetchReport] = useState<FetchReport | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingResolve = useRef<((accept: boolean) => void) | null>(null);
  const requestId = useRef(0);
  // A write that finishes after the book was switched must reload the book on screen now,
  // not the one that was selected when the write started.
  const current = useRef<{ book: Book; add: number | null }>({ book: "paper", add: null });

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem("quantmind:theme");
      const savedSidebar = window.localStorage.getItem("quantmind:sidebar-collapsed");
      const savedBook = window.localStorage.getItem("quantmind:book");
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
      if (savedSidebar === "true") setSidebarCollapsed(true);
      if (savedBook === "paper" || savedBook === "real") setBookState(savedBook);
    } catch {
      // The app remains usable when browser storage is disabled.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem("quantmind:theme", theme);
      window.localStorage.setItem("quantmind:sidebar-collapsed", String(sidebarCollapsed));
      window.localStorage.setItem("quantmind:book", book);
    } catch {
      // Preferences are an enhancement; they are not required for the app to work.
    }
  }, [book, hydrated, sidebarCollapsed, theme]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const load = useCallback(async (targetBook: Book, targetAdd: number | null) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ book: targetBook });
      if (targetAdd !== null) params.set("add", String(targetAdd));
      const response = await fetch(`/api/state?${params.toString()}`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const payload = await response.json().catch(() => null);
      if (id !== requestId.current) return; // a newer request has replaced this one
      if (!response.ok) {
        setError(payload?.error ?? "تعذر تحميل البيانات.");
        return;
      }
      setData(payload as StateResponse);
      setError(null);
    } catch {
      if (id === requestId.current) setError("مفيش اتصال بالخادم. اتأكد من الإنترنت وجرّب تاني.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hydrated) void load(book, add);
  }, [add, book, hydrated, load]);

  current.current = { book, add };
  const refresh = useCallback(() => load(current.current.book, current.current.add), [load]);

  const setBook = useCallback((next: Book) => {
    setBookState(next);
    setAddState(null);
  }, []);

  const setAdd = useCallback((value: number | null) => setAddState(value), []);

  const answerPending = useCallback((accept: boolean) => {
    pendingResolve.current?.(accept);
    pendingResolve.current = null;
    setPending(null);
  }, []);

  const send = useCallback(
    async (method: "POST" | "PUT" | "DELETE", url: string, body?: unknown, also?: () => Promise<unknown>) => {
      try {
        const request = (payloadBody: unknown) =>
          fetch(url, {
            method,
            credentials: "same-origin",
            headers: payloadBody === undefined ? undefined : { "Content-Type": "application/json" },
            body: payloadBody === undefined ? undefined : JSON.stringify(payloadBody),
          });
        let response = await request(body);
        if (response.status === 401) {
          window.location.assign("/login");
          return false;
        }
        let payload = await response.json().catch(() => null);
        if (response.status === 409 && payload?.confirm && body && typeof body === "object") {
          // the server wants a second look: ask, and only then repeat the same entry with confirm set
          const accepted = await new Promise<boolean>((resolve) => {
            pendingResolve.current = resolve;
            setPending({ message: payload?.error ?? "القيمة دي بعيدة عن آخر قراءة. متأكد؟" });
          });
          if (!accepted) return false;
          response = await request({ ...(body as Record<string, unknown>), confirm: true });
          payload = await response.json().catch(() => null);
        }
        if (!response.ok) {
          notify(payload?.error ?? "العملية ما تمتش.");
          return false;
        }
        await Promise.all([load(current.current.book, current.current.add), also?.()]);
        if (typeof payload?.message === "string") notify(payload.message);
        return true;
      } catch {
        notify("مفيش اتصال بالخادم. العملية ما اتسجلتش.");
        return false;
      }
    },
    [load, notify],
  );

  const pullReference = useCallback(async () => {
    setPulling(true);
    try {
      const response = await fetch("/api/reference", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        notify(payload?.error ?? "تعذر تحديث الأسعار المرجعية.");
        return;
      }
      const report: FetchReport = { ok: payload?.ok ?? [], failed: payload?.failed ?? {} };
      setFetchReport(report);
      const failed = Object.keys(report.failed).length;
      notify(failed ? `اتحدّث ${report.ok.length} وفشل ${failed} مصدر. التفاصيل في صفحة الأسعار.` : "الأسعار المرجعية اتحدّثت.");
      await load(current.current.book, current.current.add);
    } catch {
      notify("مفيش اتصال بالخادم.");
    } finally {
      setPulling(false);
    }
  }, [load, notify]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
    window.location.assign("/login");
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      mobileOpen,
      setMobileOpen,
      sidebarCollapsed,
      setSidebarCollapsed,
      searchQuery,
      setSearchQuery,
      book,
      setBook,
      add,
      setAdd,
      data,
      loading,
      error,
      refresh,
      send,
      toast,
      notify,
      pending,
      answerPending,
      pullReference,
      pulling,
      fetchReport,
      signOut,
    }),
    [add, answerPending, book, data, error, fetchReport, loading, mobileOpen, notify, pending, pullReference, pulling, refresh, searchQuery, send, setAdd, setBook, sidebarCollapsed, signOut, theme, toast],
  );

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio(): PortfolioContextValue {
  const context = useContext(PortfolioContext);
  if (!context) throw new Error("usePortfolio must be used inside a PortfolioProvider");
  return context;
}
