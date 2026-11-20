import "server-only";
import { PriceStore, type Config, type LedgerRow } from "@/lib/engine";
import type { OpState } from "@/lib/ops";
import { buildConfig, OVERRIDES_KEY, type Overrides } from "./config";
import { readLedger, readPrices, readSetting, type StoredPrice } from "./db";

type Queryable = Parameters<typeof readLedger>[0];

export interface Loaded extends OpState {
  config: Config;
  ledger: LedgerRow[];
  priceRows: StoredPrice[];
}

export async function loadState(q: Queryable, book: string): Promise<Loaded> {
  const [overrides, ledger, priceRows] = await Promise.all([
    readSetting<Overrides>(q, OVERRIDES_KEY),
    readLedger(q, book),
    readPrices(q, book),
  ]);
  return { config: buildConfig(overrides), ledger, priceRows, prices: new PriceStore(priceRows), book };
}
