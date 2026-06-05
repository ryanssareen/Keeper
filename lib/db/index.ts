import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

/**
 * Lazily-initialized Neon HTTP query function.
 *
 * Lazy on purpose: pure modules (the engine, its tests) must not crash at import
 * time when DATABASE_URL is unset. Only code that actually touches the DB calls db().
 */
export function db(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a Neon connection string to .env.local (see .env.example).",
    );
  }
  cached = neon(url);
  return cached;
}
