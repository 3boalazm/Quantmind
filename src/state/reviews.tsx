"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReviewResult, ReviewsView } from "@/lib/followup";
import { fingerprint, randomHex } from "./op-id";
import { usePortfolio } from "./portfolio-provider";

export interface ReviewInput {
  result: ReviewResult;
  note: string;
  /** The person's own choice of days until the next review; null keeps the item's rhythm. */
  next_in_days: number | null;
}

export interface ReviewsHandle {
  data: ReviewsView | null;
  error: string | null;
  reload: () => Promise<void>;
  /** Stores one review and reloads. Resolves to true when it was stored. */
  record: (item: string, input: ReviewInput) => Promise<boolean>;
  /** Removes the newest review of an item. */
  undo: (item: string) => Promise<boolean>;
}

const ReviewsContext = createContext<ReviewsHandle | null>(null);

/** Reloaded when the app comes back to the front, so the count in the menu is never a day old. */
const STALE_MS = 60_000;

export function ReviewsProvider({ children }: { children: ReactNode }) {
  const { send } = usePortfolio();
  const [data, setData] = useState<ReviewsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const loadedAt = useRef(0);
  const nonce = useRef("");

  const reload = useCallback(async () => {
    const id = ++request.current;
    try {
      const response = await fetch("/api/reviews", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const payload = await response.json().catch(() => null);
      if (id !== request.current) return;
      if (!response.ok) {
        setError(payload?.error ?? "تعذر تحميل المراجعات.");
        return;
      }
      loadedAt.current = Date.now();
      setData(payload as ReviewsView);
      setError(null);
    } catch {
      if (id === request.current) setError("مفيش اتصال بالخادم. اتأكد من الإنترنت وجرّب تاني.");
    }
  }, []);

  useEffect(() => {
    void reload();
    const onShow = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > STALE_MS) void reload();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [reload]);

  const record = useCallback(
    async (item: string, input: ReviewInput) => {
      if (!nonce.current) nonce.current = randomHex();
      const body = { op: "record", item, ...input };
      const op_id = `${nonce.current}-${fingerprint(JSON.stringify(body))}`;
      const done = await send("POST", "/api/reviews", { ...body, op_id }, reload);
      if (done) nonce.current = "";
      return done;
    },
    [reload, send],
  );

  const undo = useCallback((item: string) => send("POST", "/api/reviews", { op: "undo", item }, reload), [reload, send]);

  const value = useMemo(() => ({ data, error, reload, record, undo }), [data, error, reload, record, undo]);
  return <ReviewsContext.Provider value={value}>{children}</ReviewsContext.Provider>;
}

export function useReviews(): ReviewsHandle {
  const value = useContext(ReviewsContext);
  if (!value) throw new Error("useReviews must be used inside ReviewsProvider");
  return value;
}
