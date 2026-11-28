"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BudgetView } from "@/lib/budget";
import { fingerprint, randomHex } from "./op-id";
import { usePortfolio } from "./portfolio-provider";

export interface BudgetHandle {
  data: BudgetView | null;
  error: string | null;
  reload: () => Promise<void>;
  /** Sends one budget operation, shows the outcome and reloads. Resolves to true when it was stored. */
  post: (body: Record<string, unknown>) => Promise<boolean>;
}

/** The budget as the server sees it, for the cycle starting at `cycle` (or the current one). */
export function useBudget(cycle?: string | null): BudgetHandle {
  const { send } = usePortfolio();
  const [data, setData] = useState<BudgetView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const nonce = useRef("");

  const reload = useCallback(async () => {
    const id = ++request.current;
    try {
      const query = cycle ? `?cycle=${encodeURIComponent(cycle)}` : "";
      const response = await fetch(`/api/budget${query}`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const payload = await response.json().catch(() => null);
      if (id !== request.current) return;
      if (!response.ok) {
        setError(payload?.error ?? "تعذر تحميل الميزانية.");
        return;
      }
      setData(payload as BudgetView);
      setError(null);
    } catch {
      if (id === request.current) setError("مفيش اتصال بالخادم. اتأكد من الإنترنت وجرّب تاني.");
    }
  }, [cycle]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      // One id per submission: the same content sent again after a lost reply is stored once.
      if (!nonce.current) nonce.current = randomHex();
      const op_id = `${nonce.current}-${fingerprint(JSON.stringify(body))}`;
      const done = await send("POST", "/api/budget", { ...body, op_id }, reload);
      if (done) nonce.current = "";
      return done;
    },
    [reload, send],
  );

  return { data, error, reload, post };
}
