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
  // One after another: inside a transaction all three run on the same connection, which takes one query at a time.
  const overrides = await readSetting<Overrides>(q, OVERRIDES_KEY);
  const ledger = await readLedger(q, book);
  const priceRows = await readPrices(q, book);
  return { config: buildConfig(overrides), ledger, priceRows, prices: new PriceStore(priceRows), book };
}
