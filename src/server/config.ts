import "server-only";
import base from "../../config/portfolio.json";
import type { Config } from "@/lib/engine";

export const BOOKS = ["paper", "real"] as const;
export type Book = (typeof BOOKS)[number];

export function isBook(value: unknown): value is Book {
  return typeof value === "string" && (BOOKS as readonly string[]).includes(value);
}

/** The few things that can be changed from the settings screen; everything else lives in config/portfolio.json. */
export interface Overrides {
  monthly_contribution?: number;
  crypto_enabled?: boolean;
  macro?: { cbe_deposit_rate?: number; inflation_urban?: number; as_of?: string };
}

export const OVERRIDES_KEY = "config_overrides";

export function buildConfig(overrides: Overrides | null): Config {
  const config = structuredClone(base) as unknown as Config;
  if (!overrides) return config;
  if (typeof overrides.monthly_contribution === "number") config.monthly_contribution = overrides.monthly_contribution;
  if (typeof overrides.crypto_enabled === "boolean" && config.crypto) config.crypto.enabled = overrides.crypto_enabled;
  if (overrides.macro) config.macro = { ...config.macro, ...overrides.macro };
  return config;
}

/** Today in Cairo, as YYYY-MM-DD. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
