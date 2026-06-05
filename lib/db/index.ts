import postgres from "postgres";

type Db = ReturnType<typeof postgres>;

let cached: Db | null = null;

/**
 * Lazily-initialized postgres.js client (Supabase transaction pooler).
 *
 * Lazy on purpose: pure modules (the engine, its tests) must not crash at import time when
 * DATABASE_URL is unset. Only code that actually touches the DB calls db().
 */
export function db(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase transaction-pooler connection string to .env.local (see .env.example).",
    );
  }
  // prepare:false is required for the Supabase transaction pooler (Supavisor, port 6543),
  // which does not support prepared statements.
  cached = postgres(url, { prepare: false });
  return cached;
}
