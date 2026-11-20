import "server-only";
import { Pool, types, type PoolClient } from "pg";
import type { LedgerRow, LedgerType, PriceRow } from "@/lib/engine";

// DATE columns come back as plain `YYYY-MM-DD` strings, never as local-time Date objects.
types.setTypeParser(1082, (value: string) => value);

/** Reference series (exchange rate, global gold, BTC) are stored once and shared by every book. */
export const SHARED_BOOK = "*";

export class NotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set");
  }
}

const globalForDb = globalThis as unknown as { qmPool?: Pool; qmSchema?: Promise<void> };

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

function pool(): Pool {
  if (!globalForDb.qmPool) {
    const connectionString = databaseUrl();
    if (!connectionString) throw new NotConfiguredError();
    globalForDb.qmPool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  }
  return globalForDb.qmPool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger (
  id          BIGSERIAL PRIMARY KEY,
  book        TEXT NOT NULL,
  day         DATE NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('deposit','withdraw','buy','sell','income','fee')),
  instrument  TEXT NOT NULL DEFAULT '',
  units       DOUBLE PRECISION NOT NULL DEFAULT 0,
  price       DOUBLE PRECISION NOT NULL DEFAULT 0,
  amount      DOUBLE PRECISION NOT NULL DEFAULT 0,
  fee         DOUBLE PRECISION NOT NULL DEFAULT 0,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_book_day ON ledger (book, day, id);
CREATE TABLE IF NOT EXISTS prices (
  book        TEXT NOT NULL,
  instrument  TEXT NOT NULL,
  day         DATE NOT NULL,
  price       DOUBLE PRECISION NOT NULL CHECK (price > 0),
  source      TEXT NOT NULL DEFAULT 'manual',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book, instrument, day)
);
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_attempts (
  id          BIGSERIAL PRIMARY KEY,
  ip          TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_attempts_ip_at ON auth_attempts (ip, at);
`;

/** Creates the tables on first use. An advisory lock keeps parallel cold starts from racing. */
function ensureSchema(): Promise<void> {
  if (!globalForDb.qmSchema) {
    globalForDb.qmSchema = (async () => {
      const client = await pool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(7426001)");
        await client.query(SCHEMA);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => {
      globalForDb.qmSchema = undefined;
      throw error;
    });
  }
  return globalForDb.qmSchema;
}

type Queryable = Pick<PoolClient, "query">;

export async function db(): Promise<Queryable> {
  await ensureSchema();
  return pool();
}

/** Runs `fn` in one transaction, serialised per book so two writes cannot interleave. */
export async function withBook<T>(book: string, fn: (client: Queryable) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7426002, hashtext($1))", [book]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

interface LedgerDbRow {
  id: string;
  day: string;
  type: LedgerType;
  instrument: string;
  units: number;
  price: number;
  amount: number;
  fee: number;
  note: string;
}

export async function readLedger(q: Queryable, book: string): Promise<LedgerRow[]> {
  const { rows } = await q.query<LedgerDbRow>(
    "SELECT id, day, type, instrument, units, price, amount, fee, note FROM ledger WHERE book = $1 ORDER BY day, id",
    [book],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    date: r.day,
    type: r.type,
    instrument: r.instrument,
    units: r.units,
    price: r.price,
    amount: r.amount,
    fee: r.fee,
    note: r.note,
  }));
}

export async function insertLedger(q: Queryable, book: string, row: Omit<LedgerRow, "id">): Promise<number> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO ledger (book, day, type, instrument, units, price, amount, fee, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [book, row.date, row.type, row.instrument, row.units, row.price, row.amount, row.fee, row.note],
  );
  return Number(rows[0].id);
}

export async function deleteLedger(q: Queryable, book: string, id: number): Promise<void> {
  await q.query("DELETE FROM ledger WHERE book = $1 AND id = $2", [book, id]);
}

export interface StoredPrice extends PriceRow {
  book: string;
  source: string;
}

/** Prices visible to a book: its own marks and trades plus the shared reference series. */
export async function readPrices(q: Queryable, book: string): Promise<StoredPrice[]> {
  const { rows } = await q.query<{ book: string; instrument: string; day: string; price: number; source: string }>(
    "SELECT book, instrument, day, price, source FROM prices WHERE book IN ($1, $2) ORDER BY instrument, day",
    [book, SHARED_BOOK],
  );
  return rows.map((r) => ({ book: r.book, instrument: r.instrument, date: r.day, price: r.price, source: r.source }));
}

export async function upsertPrice(q: Queryable, book: string, row: PriceRow): Promise<void> {
  await q.query(
    `INSERT INTO prices (book, instrument, day, price, source) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (book, instrument, day) DO UPDATE SET price = EXCLUDED.price, source = EXCLUDED.source, updated_at = now()`,
    [book, row.instrument, row.date, row.price, row.source ?? "manual"],
  );
}

export async function deletePrice(q: Queryable, book: string, instrument: string, day: string): Promise<number> {
  const result = await q.query("DELETE FROM prices WHERE book = $1 AND instrument = $2 AND day = $3", [book, instrument, day]);
  return result.rowCount ?? 0;
}

export async function readSetting<T>(q: Queryable, key: string): Promise<T | null> {
  const { rows } = await q.query<{ value: T }>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows.length ? rows[0].value : null;
}

export async function writeSetting(q: Queryable, key: string, value: unknown): Promise<void> {
  await q.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/* ---------- login throttling ---------- */
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_MAX_FAILURES = 5;

export async function recentFailures(q: Queryable, ip: string): Promise<number> {
  const { rows } = await q.query<{ n: string }>(
    `SELECT count(*) AS n FROM auth_attempts WHERE ip = $1 AND at > now() - make_interval(mins => $2)`,
    [ip, LOGIN_WINDOW_MINUTES],
  );
  return Number(rows[0].n);
}

export async function recordFailure(q: Queryable, ip: string): Promise<void> {
  await q.query("INSERT INTO auth_attempts (ip) VALUES ($1)", [ip]);
  await q.query("DELETE FROM auth_attempts WHERE at < now() - interval '1 day'");
}

export async function clearFailures(q: Queryable, ip: string): Promise<void> {
  await q.query("DELETE FROM auth_attempts WHERE ip = $1", [ip]);
}
