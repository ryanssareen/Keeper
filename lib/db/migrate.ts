import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";

// Load .env.local for script context (Next loads it automatically at runtime).
config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (.env.local). Paste a Neon connection string first.");
  }
  const schema = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Simple-query protocol runs the whole multi-statement schema in one round trip.
    await pool.query(schema);
    console.log("✅ Schema applied.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌ migrate failed:", e);
  process.exit(1);
});
