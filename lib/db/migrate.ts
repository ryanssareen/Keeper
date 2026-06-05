import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

// Load .env.local for script context (Next loads it automatically at runtime).
config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set (.env.local). Paste your Supabase transaction-pooler connection string first.",
    );
  }
  const schema = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");

  // Strip full-line comments, then run each statement individually — the pooler's extended
  // protocol rejects multiple commands packed into one query.
  const statements = schema
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    for (const stmt of statements) {
      await sql.unsafe(stmt);
    }
    console.log(`✅ Schema applied (${statements.length} statements).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("❌ migrate failed:", e);
  process.exit(1);
});
