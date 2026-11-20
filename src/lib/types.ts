import type { Config, ISODate, LedgerRow, Summary } from "./engine";

export type Book = "paper" | "real";

export interface LatestPrice {
  instrument: string;
  date: ISODate;
  price: number;
  previous: number | null;
  points: number;
  source: string;
}

export interface StateResponse {
  book: Book;
  today: ISODate;
  asof: ISODate;
  add: number;
  summary: Summary;
  ledger: LedgerRow[];
  prices: LatestPrice[];
  config: Pick<Config, "name" | "monthly_contribution" | "instruments" | "buckets" | "stages" | "crypto" | "rules"> & {
    macro: NonNullable<Config["macro"]>;
  };
}

export const BOOK_LABEL: Record<Book, string> = { paper: "دفتر تجريبي", real: "دفتر حقيقي" };
